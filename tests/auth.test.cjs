const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server.cjs');
const A = require('../lib/auth.cjs');
const { randomUUID } = require('node:crypto');
const ORIGIN = 'http://127.0.0.1:4173';
test('email preapproval requires admin and verified Google identity, and is consumed once',async t=>{
  const {request,seed,db}=await fixture(t);
  const admin=await seed(),other=await seed('consulta');
  const a=await request('/api/v1/auth/login',{method:'POST',body:admin});
  const o=await request('/api/v1/auth/login',{method:'POST',body:other});
  const route='/api/v1/email-approvals',body={email:'  Invited@Example.test ',role:'compras'};
  assert.equal((await request(route)).status,401);
  for(const method of ['GET','POST','DELETE'])assert.equal((await request(route,{method,cookie:o.cookie,...(method==='GET'?{}:{body})})).status,403);
  assert.equal((await request(route,{method:'POST',cookie:a.cookie,body,origin:'https://evil.example'})).status,403);
  assert.equal((await request(route,{method:'POST',cookie:a.cookie,body:{...body,role:'root'}})).status,400);
  assert.equal((await request(route,{method:'POST',cookie:a.cookie,body})).status,200);
  assert.equal((await request(route,{method:'POST',cookie:a.cookie,body})).status,200);
  assert.equal((await request(route,{cookie:a.cookie})).data.approvals.length,1);
  const id=randomUUID();
  (await db.createUser({id:id,email:'invited@example.test',name:'Invited',created_at:new Date().toISOString()}));
  let user=(await db.getUser(id));
  assert.equal((await A.applyGoogleApproval(db,user)).status,'pending');
  assert.equal((await request(route,{method:'POST',cookie:a.cookie,body})).status,409);
  (await db.updateUser(id,{google_sub:'verified-test-sub'}));
  user=(await A.applyGoogleApproval(db,(await db.getUser(id))));
  assert.equal(user.status,'active');assert.equal(user.role,'compras');
  assert.equal((await request(route,{cookie:a.cookie})).data.approvals.length,0);
  (await db.updateUser(id,{status:'disabled'}));
  assert.equal((await A.applyGoogleApproval(db,(await db.getUser(id)))).status,'disabled');
  await request(route,{method:'POST',cookie:a.cookie,body:{email:'revoke@example.test',role:'consulta'}});
  assert.equal((await request(route,{method:'DELETE',cookie:a.cookie,body:{email:'revoke@example.test'}})).status,200);
  assert.equal((await request(route,{cookie:a.cookie})).data.approvals.length,0);
  assert.equal((await ({n:(await db.listAudit('access.email.claimed')).length})).n,1);
});
async function fixture(t, config={}) {
  const database=process.env.FIRESTORE_EMULATOR_HOST
    ? { projectId:'demo-nexo', namespace:'test_'+randomUUID().replaceAll('-','') }
    : { memory:true };
  const app=createApp({database,origin:ORIGIN,googleClientId:'',googleClientSecret:'',...config});
  await app.ready;
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    await new Promise(resolve=>app.server.close(resolve));
    await app.closed;
  });
  const base='http://127.0.0.1:'+app.server.address().port;
  async function request(route,{method='GET',cookie='',body,origin=ORIGIN,accept}={}) {
    const response=await fetch(base+route,{method,redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json',...(accept?{Accept:accept}:{}),...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
    return {status:response.status,headers:response.headers,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function seed(role='administrador', status='active') {
    const id=randomUUID(),email=id+'@example.test',password='A-strong-test-password-48';
    const hash=await A.hashPassword(password);
    (await app.db.createUser({id:id,email:email,name:'Test User',password_hash:hash,role:role,status:status,created_at:new Date().toISOString()}));
    return {id,email,password};
  }
  return {...app,request,seed,database};
}
test('simultaneous rate limits and transactions preserve consistency',async t=>{
  const {db}=await fixture(t);
  const results=await Promise.allSettled(Array.from({length:20},()=>A.rateLimit(db,'parallel',5)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,5);
  assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.status===429));
  await assert.rejects(db.transaction(async()=>{
    await A.audit(db,null,null,'rollback.test');
    throw new Error('rollback');
  }),/rollback/);
  assert.equal((await ({n:(await db.listAudit('rollback.test')).length})).n,0);
});
test('Firestore shares sessions and rate limits between connections',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async t=>{
  const {database,db,seed}=await fixture(t);
  const second=A.openDatabase(database);await second.ready;
  try{
    const user=await seed();
    const token=await A.createSession(db,user.id);
    assert.equal((await A.sessionUser(second,token)).id,user.id);
    await second.revokeSessions(user.id);
    assert.equal(await A.sessionUser(db,token),null);
    const results=await Promise.allSettled(Array.from({length:20},(_,i)=>A.rateLimit(i%2?db:second,'replicas',5)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,5);
  }finally{await second.close();}
});
test('concurrent identities and OAuth states are claimed only once',async t=>{
  const {db}=await fixture(t);
  const input={email:'unique@example.test',name:'Unique User',created_at:new Date().toISOString()};
  const rows=await Promise.all(Array.from({length:8},()=>db.createUser({...input,id:randomUUID()})));
  assert.equal(rows.filter(Boolean).length,1);
  await db.saveOAuth({state_hash:'one-time',binding_hash:'browser',nonce:'nonce',verifier:'verifier',expires_at:Date.now()+60000});
  const states=await Promise.all(Array.from({length:8},()=>db.consumeOAuth('one-time','browser',Date.now())));
  assert.equal(states.filter(Boolean).length,1);
  await assert.rejects(db.transaction(async()=>{
    await db.createUser({...input,email:'rollback@example.test',id:randomUUID()});
    throw new Error('rollback identity');
  }),/rollback identity/);
  assert.equal(await db.findUser('email','rollback@example.test'),undefined);
});
test('expiry is enforced without waiting for Firestore TTL cleanup',async t=>{
  const {db,seed}=await fixture(t);const user=await seed();
  const token='expired-session';
  await db.saveSession({token_hash:A.digest(token),user_id:user.id,session_version:0,expires_at:Date.now()-1});
  assert.equal(await A.sessionUser(db,token),null);
  await db.saveRateLimit({key:'expired-rate',count:100,expires_at:Date.now()-1});
  await A.rateLimit(db,'expired-rate',1);
  await assert.rejects(A.rateLimit(db,'expired-rate',1),error=>error.status===429);
  await db.saveOAuth({state_hash:'expired',binding_hash:'browser',nonce:'nonce',verifier:'verifier',expires_at:Date.now()-1});
  assert.equal(await db.consumeOAuth('expired','browser',Date.now()),undefined);
});
test('Firestore rules reject direct browser access',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async t=>{
  const {database,seed}=await fixture(t);const user=await seed();
  const endpoint=`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-nexo/databases/(default)/documents/nexo/${database.namespace}/users/${A.digest(user.id)}`;
  assert.equal((await fetch(endpoint)).status,403);
  assert.equal((await fetch(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{role:{stringValue:'administrador'}}})})).status,403);
});
test('simultaneous administrator changes retain an active administrator',async t=>{
  const {request,seed,db}=await fixture(t);
  const a=await seed(),b=await seed();
  const loginA=await request('/api/v1/auth/login',{method:'POST',body:a});
  const loginB=await request('/api/v1/auth/login',{method:'POST',body:b});
  const responses=await Promise.all([
    request('/api/v1/users/'+a.id,{method:'PATCH',cookie:loginA.cookie,body:{role:'consulta',status:'active'}}),
    request('/api/v1/users/'+b.id,{method:'PATCH',cookie:loginB.cookie,body:{role:'consulta',status:'active'}})
  ]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal((await ({n:await db.countAdmins()})).n,1);
});
test('anonymous and pending users cannot load the operational app or users API',async t=>{
  const {request,db}=await fixture(t);
  assert.equal((await request('/app.js')).status,401);
  assert.equal((await request('/api/v1/users')).status,401);
  const account={email:'new@example.test',name:'New User',password:'correct-password-123',role:'administrador',status:'active'};
  assert.equal((await request('/api/v1/auth/register',{method:'POST',body:account})).status,202);
  const stored=(await db.findUser('email',account.email));
  assert.equal(stored.role,'consulta');assert.equal(stored.status,'pending');assert.notEqual(stored.password_hash,account.password);
  const login=await request('/api/v1/auth/login',{method:'POST',body:account});assert.equal(login.status,200);
  assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Lax/);
  assert.equal((await request('/app.js',{cookie:login.cookie})).status,403);
  assert.equal((await request('/api/v1/users',{cookie:login.cookie})).status,403);
  assert.equal((await request('/api/v1/me',{cookie:login.cookie})).data.user.email,account.email);
  const duplicate=await request('/api/v1/auth/register',{method:'POST',body:account});assert.equal(duplicate.status,202);
  assert.equal((await ({n:(await db.listUsers()).length})).n,1);
});
test('login validation, CSRF checks, profile persistence, and logout invalidation',async t=>{
  const {request,seed,db}=await fixture(t);const user=await seed('consulta');
  assert.equal((await request('/api/v1/auth/login',{method:'POST',body:{...user,password:'wrong'}})).status,401);
  assert.equal((await request('/api/v1/auth/login',{method:'POST',origin:'https://evil.example',body:user})).status,403);
  const login=await request('/api/v1/auth/login',{method:'POST',body:user});assert.equal(login.status,200);
  assert.equal((await request('/api/v1/users',{cookie:login.cookie})).status,403);
  const profile={name:'Updated Profile',department:'Operaciones',phone:'5551234567'};
  assert.equal((await request('/api/v1/me',{method:'PATCH',cookie:login.cookie,body:{...profile,role:'administrador'}})).status,400);
  const updated=await request('/api/v1/me',{method:'PATCH',cookie:login.cookie,body:profile});assert.equal(updated.status,200);
  assert.equal((await db.getUser(user.id)).department,'Operaciones');
  assert.equal(updated.data.user.password_hash,undefined);
  assert.equal((await request('/app.js',{cookie:login.cookie})).status,200);
  await request('/api/v1/auth/logout',{method:'POST',cookie:login.cookie,body:{}});
  assert.equal((await request('/api/v1/me',{cookie:login.cookie})).status,401);
});
test('administrators approve users, revoke sessions and cannot remove the last admin',async t=>{
  const {request,seed}=await fixture(t);const admin=await seed(),pending=await seed('consulta','pending');
  const a=await request('/api/v1/auth/login',{method:'POST',body:admin}),p=await request('/api/v1/auth/login',{method:'POST',body:pending});
  const list=await request('/api/v1/users',{cookie:a.cookie});assert.equal(list.status,200);assert.equal(list.data.users.length,2);
  assert.equal((await request('/api/v1/users/'+pending.id,{method:'PATCH',cookie:p.cookie,body:{role:'administrador',status:'active'}})).status,403);
  const approve=await request('/api/v1/users/'+pending.id,{method:'PATCH',cookie:a.cookie,body:{role:'almacen',status:'active'}});assert.equal(approve.status,200);
  assert.equal((await request('/api/v1/me',{cookie:p.cookie})).status,401);
  const last=await request('/api/v1/users/'+admin.id,{method:'PATCH',cookie:a.cookie,body:{role:'consulta',status:'active'}});assert.equal(last.status,409);
  const active=await request('/api/v1/auth/login',{method:'POST',body:pending});assert.equal(active.data.user.role,'almacen');
  await request('/api/v1/users/'+pending.id,{method:'PATCH',cookie:a.cookie,body:{role:'almacen',status:'disabled'}});
  assert.equal((await request('/api/v1/me',{cookie:active.cookie})).status,401);
  assert.equal((await request('/api/v1/auth/login',{method:'POST',body:pending})).status,401);
});
test('password changes require the current password and invalidate older sessions',async t=>{
  const {request,seed}=await fixture(t);const user=await seed('consulta');
  const a=await request('/api/v1/auth/login',{method:'POST',body:user}),b=await request('/api/v1/auth/login',{method:'POST',body:user});
  const next='new-correct-password-456';
  assert.equal((await request('/api/v1/me/password',{method:'POST',cookie:a.cookie,body:{currentPassword:'wrong',newPassword:next}})).status,400);
  const changed=await request('/api/v1/me/password',{method:'POST',cookie:a.cookie,body:{currentPassword:user.password,newPassword:next}});assert.equal(changed.status,200);
  assert.equal((await request('/api/v1/me',{cookie:b.cookie})).status,401);
  assert.equal((await request('/api/v1/me',{cookie:changed.cookie})).status,200);
  assert.equal((await request('/api/v1/auth/login',{method:'POST',body:user})).status,401);
  assert.equal((await request('/api/v1/auth/login',{method:'POST',body:{...user,password:next}})).status,200);
});
test('login throttling returns 429 before password verification',async t=>{
  const {request,db}=await fixture(t);
  (await db.saveRateLimit({key:'login-email:'+A.digest('locked@example.test'),count:10,expires_at:Date.now()+60000}));
  assert.equal((await request('/api/v1/auth/login',{method:'POST',body:{email:'locked@example.test',password:'whatever'}})).status,429);
});
test('Google disabled state is explicit, not a simulated login',async t=>{
  const {request}=await fixture(t);
  assert.equal((await request('/api/v1/auth/config')).data.googleEnabled,false);
  const response=await request('/api/v1/auth/google');assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/?auth_error=google_unavailable');
});
test('Google flow uses state, nonce, PKCE, and rejects an unbound callback',async t=>{
  const {request,db}=await fixture(t,{googleClientId:'test-client',googleClientSecret:'test-secret'});
  const start=await request('/api/v1/auth/google'),url=new URL(start.headers.get('location'));
  assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.ok(url.searchParams.get('nonce'));assert.ok(url.searchParams.get('state'));assert.match(start.headers.get('set-cookie'),/HttpOnly/);
  const bad=await request('/api/v1/auth/google/callback?state='+url.searchParams.get('state')+'&code=untrusted');
  assert.equal(bad.headers.get('location'),'/?auth_error=google_failed');assert.equal((await ({n:(await db.listUsers()).length})).n,0);
  const cancelled=await request('/api/v1/auth/google/callback?state='+url.searchParams.get('state')+'&error=access_denied',{cookie:start.cookie});
  assert.equal(cancelled.headers.get('location'),'/?auth_error=google_cancelled');
  assert.equal((await ({n:(await db.listOAuth()).length})).n,0);
});
test('non-public files cannot be fetched and nonlocal plain HTTP is refused',async t=>{
  const {request}=await fixture(t);
  for(const p of ['/.env','/package.json','/data/nexo.sqlite','/server.cjs','/.git/config'])assert.equal((await request(p)).status,404);
  assert.throws(()=>createApp({database:':memory:',origin:'http://example.com'}),/HTTPS/);
});

test('Google callback creates a persistent session only after verified identity and respects approval',async t=>{
  const { OAuth2Client } = require('google-auth-library');
  const {request,db}=await fixture(t,{googleClientId:'test-client',googleClientSecret:'test-secret'});
  let claims, expectedVerifier;
  t.mock.method(OAuth2Client.prototype,'getToken',async input=>{
    assert.equal(input.codeVerifier,expectedVerifier);
    assert.equal(input.redirect_uri,ORIGIN+'/api/v1/auth/google/callback');
    return {tokens:{id_token:'provider-token-stub'}};
  });
  t.mock.method(OAuth2Client.prototype,'verifyIdToken',async input=>{
    assert.deepEqual(input,{idToken:'provider-token-stub',audience:'test-client'});
    return {getPayload:()=>claims};
  });
  for (const approved of [false,true]) {
    const email=`google-${approved}@example.test`;
    if(approved)await db.saveApproval({email,role:'compras',approved_by:'test-admin',created_at:new Date().toISOString()});
    const start=await request('/api/v1/auth/google',{accept:'application/json'});
    assert.equal(start.status,200);
    const target=new URL(start.data.url);
    assert.equal(target.origin,'https://accounts.google.com');
    const stored=(await db.listOAuth()).find(row=>row.state_hash===A.digest(target.searchParams.get('state')));
    expectedVerifier=stored.verifier;
    claims={email,email_verified:true,sub:`google-sub-${approved}`,name:'Google User',nonce:target.searchParams.get('nonce')};
    const callback='/api/v1/auth/google/callback?state='+target.searchParams.get('state')+'&code=verified-code';
    const logged=await request(callback,{cookie:start.cookie});
    assert.equal(logged.headers.get('location'),'/');
    assert.match(logged.cookie,/nexo_session=/);
    const me=await request('/api/v1/me',{cookie:logged.cookie});
    assert.equal(me.status,200);
    assert.equal(me.data.user.status,approved?'active':'pending');
    assert.equal(me.data.user.role,approved?'compras':'consulta');
    assert.equal((await request('/app.js',{cookie:logged.cookie})).status,approved?200:403);
    const replay=await request(callback,{cookie:start.cookie});
    assert.equal(replay.headers.get('location'),'/?auth_error=google_failed');
  }
  const start=await request('/api/v1/auth/google',{accept:'application/json'});
  const target=new URL(start.data.url);
  expectedVerifier=(await db.listOAuth())[0].verifier;
  claims={email:'invalid@example.test',email_verified:true,sub:'invalid-sub',nonce:'wrong-nonce'};
  const rejected=await request('/api/v1/auth/google/callback?state='+target.searchParams.get('state')+'&code=code',{cookie:start.cookie});
  assert.equal(rejected.headers.get('location'),'/?auth_error=google_failed');
  assert.equal(await db.findUser('email','invalid@example.test'),undefined);
});
