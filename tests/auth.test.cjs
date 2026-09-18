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
  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run(id,'invited@example.test','Invited',new Date().toISOString());
  let user=db.prepare('SELECT * FROM users WHERE id=?').get(id);
  assert.equal(A.applyGoogleApproval(db,user).status,'pending');
  assert.equal((await request(route,{method:'POST',cookie:a.cookie,body})).status,409);
  db.prepare('UPDATE users SET google_sub=? WHERE id=?').run('verified-test-sub',id);
  user=A.applyGoogleApproval(db,db.prepare('SELECT * FROM users WHERE id=?').get(id));
  assert.equal(user.status,'active');assert.equal(user.role,'compras');
  assert.equal((await request(route,{cookie:a.cookie})).data.approvals.length,0);
  db.prepare('UPDATE users SET status=? WHERE id=?').run('disabled',id);
  assert.equal(A.applyGoogleApproval(db,db.prepare('SELECT * FROM users WHERE id=?').get(id)).status,'disabled');
  await request(route,{method:'POST',cookie:a.cookie,body:{email:'revoke@example.test',role:'consulta'}});
  assert.equal((await request(route,{method:'DELETE',cookie:a.cookie,body:{email:'revoke@example.test'}})).status,200);
  assert.equal((await request(route,{cookie:a.cookie})).data.approvals.length,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit WHERE action='access.email.claimed'").get().n,1);
});
async function fixture(t, config={}) {
  const app=createApp({database:':memory:',origin:ORIGIN,googleClientId:'',googleClientSecret:'',...config});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base='http://127.0.0.1:'+app.server.address().port;
  async function request(route,{method='GET',cookie='',body,origin=ORIGIN}={}) {
    const response=await fetch(base+route,{method,redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
    return {status:response.status,headers:response.headers,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function seed(role='administrador', status='active') {
    const id=randomUUID(),email=id+'@example.test',password='A-strong-test-password-48';
    const hash=await A.hashPassword(password);
    app.db.prepare('INSERT INTO users(id,email,name,password_hash,role,status,created_at) VALUES (?,?,?,?,?,?,?)').run(id,email,'Test User',hash,role,status,new Date().toISOString());
    return {id,email,password};
  }
  return {...app,request,seed};
}
test('anonymous and pending users cannot load the operational app or users API',async t=>{
  const {request,db}=await fixture(t);
  assert.equal((await request('/app.js')).status,401);
  assert.equal((await request('/api/v1/users')).status,401);
  const account={email:'new@example.test',name:'New User',password:'correct-password-123',role:'administrador',status:'active'};
  assert.equal((await request('/api/v1/auth/register',{method:'POST',body:account})).status,202);
  const stored=db.prepare('SELECT * FROM users WHERE email=?').get(account.email);
  assert.equal(stored.role,'consulta');assert.equal(stored.status,'pending');assert.notEqual(stored.password_hash,account.password);
  const login=await request('/api/v1/auth/login',{method:'POST',body:account});assert.equal(login.status,200);
  assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Lax/);
  assert.equal((await request('/app.js',{cookie:login.cookie})).status,403);
  assert.equal((await request('/api/v1/users',{cookie:login.cookie})).status,403);
  assert.equal((await request('/api/v1/me',{cookie:login.cookie})).data.user.email,account.email);
  const duplicate=await request('/api/v1/auth/register',{method:'POST',body:account});assert.equal(duplicate.status,202);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,1);
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
  assert.equal(db.prepare('SELECT department FROM users WHERE id=?').get(user.id).department,'Operaciones');
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
  db.prepare('INSERT INTO rate_limits VALUES (?,?,?)').run('login-email:'+A.digest('locked@example.test'),10,Date.now()+60000);
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
  assert.equal(bad.headers.get('location'),'/?auth_error=google_failed');assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,0);
  const cancelled=await request('/api/v1/auth/google/callback?state='+url.searchParams.get('state')+'&error=access_denied',{cookie:start.cookie});
  assert.equal(cancelled.headers.get('location'),'/?auth_error=google_cancelled');
  assert.equal(db.prepare('SELECT count(*) AS n FROM oauth_states').get().n,0);
});
test('non-public files cannot be fetched and nonlocal plain HTTP is refused',async t=>{
  const {request}=await fixture(t);
  for(const p of ['/.env','/package.json','/data/nexo.sqlite','/server.cjs','/.git/config'])assert.equal((await request(p)).status,404);
  assert.throws(()=>createApp({database:':memory:',origin:'http://example.com'}),/HTTPS/);
});
