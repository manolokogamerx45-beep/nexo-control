const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const A = require('./lib/auth.cjs');
function createApp(config = {}) {
  const origin = config.origin || process.env.APP_ORIGIN || 'http://127.0.0.1:4173';
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin) throw new Error('APP_ORIGIN debe ser un origen sin ruta ni barra final.');
  const secure = parsedOrigin.protocol === 'https:';
  if (!secure && !['127.0.0.1','localhost','[::1]'].includes(parsedOrigin.hostname)) throw new Error('Los despliegues remotos requieren HTTPS.');
  if (process.env.NODE_ENV === 'production' && !secure) throw new Error('APP_ORIGIN debe usar HTTPS en producción.');
  const db = A.openDatabase(config.database || {});
  const clientId = config.googleClientId ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = config.googleClientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
  const googleReady = !!(clientId && clientSecret);
  const callback = origin + '/api/v1/auth/google/callback';
  const google = new OAuth2Client(clientId, clientSecret, callback);
  const cookieName = secure ? '__Host-nexo_session' : 'nexo_session';
  const oauthCookie = secure ? '__Host-nexo_oauth' : 'nexo_oauth';
  const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(s=>s.trim().split('=')).filter(a=>a.length===2));
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  const redirect = (res, target) => { res.writeHead(302, { Location: target }); res.end(); };
  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) A.bad('Se requiere JSON.', 415);
    let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 16384) A.bad('Solicitud demasiado grande.', 413); }
    try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) A.bad('JSON inválido.'); return value; }
    catch { A.bad('JSON inválido.'); }
  }
  async function setSession(req,res,id) {
    const previous = cookies(req)[cookieName];
    if (previous) (await db.deleteSession(A.digest(previous)));
    res.setHeader('Set-Cookie', cookie(cookieName, (await A.createSession(db,id)), 8*3600));
  }
  async function authenticate(req, active = false) {
    const user = (await A.sessionUser(db, cookies(req)[cookieName]));
    if (!user) A.bad('Inicia sesión para continuar.', 401);
    if (active && user.status !== 'active') A.bad('Tu cuenta está pendiente de aprobación.', 403);
    return user;
  }
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      await db.ready;
      const url = new URL(req.url, origin), route = url.pathname;
      if (route==='/health/live' && req.method==='GET') return json(res,200,{ok:true});
      if (route==='/health/ready' && req.method==='GET') {
        try { await db.health(); }
        catch { return json(res,503,{ok:false}); }
        return json(res,200,{ok:true});
      }
      if (['POST','PATCH','DELETE','PUT'].includes(req.method) && req.headers.origin !== origin) A.bad('Origen de solicitud no permitido.',403);
      if (route==='/api/v1/auth/config' && req.method==='GET') return json(res,200,{googleEnabled:googleReady,registrationEnabled:true});
      if (route==='/api/v1/auth/register' && req.method==='POST') {
        (await A.rateLimit(db,'register:'+req.socket.remoteAddress,5));
        const input=await body(req),email=A.validateEmail(input.email),name=A.validateName(input.name);
        const password=await A.hashPassword(input.password);
        // Never disclose whether the address already has an account.
        await db.transaction(async () => {
          const id=randomUUID();
          const inserted=await db.createUser({id:id,email:email,name:name,password_hash:password,created_at:new Date().toISOString()});
          if(inserted)await A.audit(db,id,id,'account.register');
        });
        return json(res,202,{message:'Solicitud recibida. Si es una cuenta nueva, un administrador debe aprobarla. Si ya tienes cuenta, inicia sesión.'});
      }
      if (route==='/api/v1/auth/login' && req.method==='POST') {
        const input=await body(req),email=A.emailOf(input.email);
        (await A.rateLimit(db,'login-ip:'+req.socket.remoteAddress,30)); (await A.rateLimit(db,'login-email:'+A.digest(email),10));
        const user=(await db.findUser('email',email));
        if (!await A.verifyPassword(input.password,user?.password_hash) || user.status==='disabled') A.bad('Correo o contraseña incorrectos.',401);
        await db.transaction(async () => {
          const current=await db.getUser(user.id);
          if(!current || current.password_hash!==user.password_hash || current.status==='disabled')A.bad('Correo o contraseña incorrectos.',401);
          await setSession(req,res,user.id);
          await A.audit(db,user.id,user.id,'session.login');
        });
        return json(res,200,{user:A.publicUser(user)});
      }
      if (route==='/api/v1/auth/logout' && req.method==='POST') {
        const token=cookies(req)[cookieName];if(token)(await db.deleteSession(A.digest(token)));
        res.setHeader('Set-Cookie',cookie(cookieName,'',0));return json(res,200,{ok:true});
      }
      if (route==='/api/v1/auth/google' && req.method==='GET') {
        if (!googleReady) {
          if (req.headers.accept === 'application/json') return json(res,503,{error:'El acceso con Google aún no está configurado.'});
          return redirect(res,'/?auth_error=google_unavailable');
        }
        (await A.rateLimit(db,'google:'+req.socket.remoteAddress,30));
        const state=A.secret(),binding=A.secret(),nonce=A.secret(),verifier=A.secret();
        (await db.saveOAuth({state_hash:A.digest(state),binding_hash:A.digest(binding),nonce:nonce,verifier:verifier,expires_at:Date.now()+600000}));
        res.setHeader('Set-Cookie',cookie(oauthCookie,binding,600));
        const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');
        target.search=new URLSearchParams({client_id:clientId,redirect_uri:callback,response_type:'code',scope:'openid email profile',state,nonce,prompt:'select_account',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
        if (req.headers.accept === 'application/json') return json(res,200,{url:target.toString()});
        return redirect(res,target.toString());
      }
      if (route==='/api/v1/auth/google/callback' && req.method==='GET') {
        if (!googleReady) return redirect(res,'/?auth_error=google_unavailable');
        const state=(await db.consumeOAuth(A.digest(url.searchParams.get('state')||''),A.digest(cookies(req)[oauthCookie]||''),Date.now()));
        res.setHeader('Set-Cookie',cookie(oauthCookie,'',0));
        if (!state || state.expires_at<Date.now() || state.binding_hash!==A.digest(cookies(req)[oauthCookie]||'')) return redirect(res,'/?auth_error=google_failed');
        if (url.searchParams.has('error') || !url.searchParams.get('code')) return redirect(res,'/?auth_error=google_cancelled');
        try {
          const {tokens}=await google.getToken({code:url.searchParams.get('code'),codeVerifier:state.verifier,redirect_uri:callback});
          const ticket=await google.verifyIdToken({idToken:tokens.id_token,audience:clientId});
          const claims=ticket.getPayload();
          if (!claims || !claims.email_verified || claims.nonce!==state.nonce || !claims.sub) throw new Error('Invalid Google identity');
          const email=A.validateEmail(claims.email);
          let user=(await db.findUser('google_sub',claims.sub));
          if (!user) {
            // Do not silently link a password account based only on matching email.
            if ((await db.findUser('email',email))) return redirect(res,'/?auth_error=account_exists');
            const id=randomUUID(), name=String(claims.name||email.split('@')[0]).slice(0,80);
            (await db.createUser({id:id,email:email,name:name,google_sub:claims.sub,created_at:new Date().toISOString()}));
            user=(await db.getUser(id));(await A.audit(db,id,id,'account.google.register'));
          }
          if(user.status==='disabled')return redirect(res,'/?auth_error=account_disabled');
          user=(await A.applyGoogleApproval(db,user));
          (await setSession(req,res,user.id));
          // Clear the transaction cookie as well as setting the new session.
          res.setHeader('Set-Cookie',[res.getHeader('Set-Cookie'),cookie(oauthCookie,'',0)]);
          (await A.audit(db,user.id,user.id,'session.google'));return redirect(res,'/');
        } catch(error) { return redirect(res,error.status===503?'/?auth_error=service_unavailable':'/?auth_error=google_failed'); }
      }
      if (route==='/api/v1/me' && req.method==='GET') return json(res,200,{user:A.publicUser((await authenticate(req)))});
      if (route==='/api/v1/me' && req.method==='PATCH') {
        const user=(await authenticate(req)),input=await body(req),name=A.validateName(input.name);
        if(typeof input.department!=='string'||input.department.length>80||typeof input.phone!=='string'||input.phone.length>30)A.bad('Revisa el departamento y teléfono.');
        if(Object.keys(input).some(k=>!['name','department','phone'].includes(k)))A.bad('Solo puedes editar tus datos de perfil.');
        (await db.updateUser(user.id,{name:name,department:input.department.trim(),phone:input.phone.trim()}));
        (await A.audit(db,user.id,user.id,'profile.update'));return json(res,200,{user:A.publicUser((await db.getUser(user.id)))});
      }
      if (route==='/api/v1/me/password' && req.method==='POST') {
        const user=(await authenticate(req)),input=await body(req);(await A.rateLimit(db,'password:'+user.id,5));
        if(!user.password_hash)A.bad('Esta cuenta administra su contraseña en Google.');
        if(!await A.verifyPassword(input.currentPassword,user.password_hash))A.bad('La contraseña actual no es correcta.',400);
        const hash=await A.hashPassword(input.newPassword);
        await db.transaction(async () => {
          const current=await authenticate(req);
          if(current.password_hash!==user.password_hash)A.bad('La contraseña cambió. Inicia sesión de nuevo.',409);
          await db.updateUser(user.id,{password_hash:hash});
          await db.revokeSessions(user.id);
          await setSession(req,res,user.id);
          await A.audit(db,user.id,user.id,'password.change');
        });
        return json(res,200,{ok:true});
      }
      if(route==='/api/v1/email-approvals') {
        const actor=(await authenticate(req,true));if(actor.role!=='administrador')A.bad('Se requieren permisos de administrador.',403);
        if(req.method==='GET')return json(res,200,{approvals:(await db.listApprovals())});
        if(req.method==='POST' || req.method==='DELETE') {
          const input=await body(req),email=A.validateEmail(input.email);
          await db.transaction(async () => {
          const currentActor=await authenticate(req,true);
          if(currentActor.role!=='administrador')A.bad('Se requieren permisos de administrador.',403);
          if(req.method==='POST') {
            if(!A.ROLES.includes(input.role))A.bad('Perfil inválido.');
            if((await db.findUser('email',email)))A.bad('Este correo ya está registrado. Modifica su estado en la lista de usuarios.',409);
            (await db.saveApproval({email:email,role:input.role,approved_by:actor.id,created_at:new Date().toISOString()}));
          } else (await db.deleteApproval(email));
          (await A.audit(db,actor.id,null,req.method==='POST'?'access.email.approved':'access.email.revoked',{email}));
          });
          return json(res,200,{ok:true});
        }
        A.bad('Método no permitido.',405);
      }
      if(route==='/api/v1/users' || /^\/api\/v1\/users\/[^/]+$/.test(route)) {
        const actor=(await authenticate(req,true));if(actor.role!=='administrador')A.bad('Se requieren permisos de administrador.',403);
        if(route==='/api/v1/users' && req.method==='GET')return json(res,200,{users:(await db.listUsers()).map(A.publicUser)});
        if(req.method==='PATCH' && route!=='/api/v1/users') {
          const id=route.split('/').pop(),input=await body(req);
          if(!A.ROLES.includes(input.role)||!A.STATUSES.includes(input.status)||Object.keys(input).some(k=>!['role','status'].includes(k)))A.bad('Rol o estado inválido.');
          await db.transaction(async () => {
            const currentActor=await authenticate(req,true);
            if(currentActor.role!=='administrador')A.bad('Se requieren permisos de administrador.',403);
            const target=(await db.getUser(id));if(!target)A.bad('Usuario no encontrado.',404);
            if(target.role==='administrador'&&target.status==='active'&&(input.role!=='administrador'||input.status!=='active')&&await db.countAdmins()<=1)A.bad('Debes conservar al menos un administrador activo.',409);
            (await db.updateUser(id,{role:input.role,status:input.status}));
            (await db.revokeSessions(id));
            (await db.deleteApproval(target.email));
            (await A.audit(db,actor.id,id,'access.update',{role:input.role,status:input.status}));
          });
          return json(res,200,{user:A.publicUser((await db.getUser(id)))});
        }
        A.bad('Método no permitido.',405);
      }
      if(route.startsWith('/api/'))A.bad('Endpoint no encontrado.',404);
      if(!['GET','HEAD'].includes(req.method))A.bad('Método no permitido.',405);
      const allowed={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/auth.css':'auth.css','/auth.js':'auth.js','/app.js':'app.js'};
      if(!allowed[route])A.bad('Archivo no encontrado.',404);
      // The operational bundle is never delivered to anonymous or pending users.
      if(route==='/app.js')(await authenticate(req,true));
      const filename=allowed[route],content=fs.readFileSync(path.join(__dirname,'dist',filename));
      const type=filename.endsWith('.css')?'text/css':filename.endsWith('.js')?'text/javascript':'text/html';
      res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:content);
    } catch(error) {
      const route = new URL(req.url, origin).pathname;
      if (req.method==='GET' && ['/api/v1/auth/google','/api/v1/auth/google/callback'].includes(route) && req.headers.accept !== 'application/json') {
        res.setHeader('Set-Cookie',cookie(oauthCookie,'',0));
        return redirect(res,error.status===429?'/?auth_error=too_many_attempts':'/?auth_error=service_unavailable');
      }
      json(res,error.status||500,{error:error.status?error.message:'Ocurrió un error. Intenta de nuevo.'});
    }
  });
  const closed = new Promise(resolve => server.on('close',()=>{ db.close().then(resolve, resolve); }));
  return {server,db,ready:db.ready,closed};
}
if(require.main===module){
  (async()=>{
    const app=createApp();
    try { await app.ready; } catch(error) { await app.db.close(); throw error; }
    const port=Number(process.env.PORT||4173);
    app.server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`JIDE NOVA CORE: ${process.env.APP_ORIGIN||'http://127.0.0.1:'+port}`));
    for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
      app.server.close();
      setTimeout(()=>process.exit(1),10000).unref();
    });
  })().catch(()=>{console.error('No se pudo iniciar la API. Revisa la configuración y la conexión a la base de datos.');process.exitCode=1;});
}
module.exports={createApp};
