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
  const db = A.openDatabase(config.database || process.env.DATABASE_PATH || './data/nexo.sqlite');
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
  function setSession(req,res,id) {
    const previous = cookies(req)[cookieName];
    if (previous) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(A.digest(previous));
    res.setHeader('Set-Cookie', cookie(cookieName, A.createSession(db,id), 8*3600));
  }
  function authenticate(req, active = false) {
    const user = A.sessionUser(db, cookies(req)[cookieName]);
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
      const url = new URL(req.url, origin), route = url.pathname;
      if (['POST','PATCH','DELETE','PUT'].includes(req.method) && req.headers.origin !== origin) A.bad('Origen de solicitud no permitido.',403);
      if (route==='/api/v1/auth/config' && req.method==='GET') return json(res,200,{googleEnabled:googleReady,registrationEnabled:true});
      if (route==='/api/v1/auth/register' && req.method==='POST') {
        A.rateLimit(db,'register:'+req.socket.remoteAddress,5);
        const input=await body(req),email=A.validateEmail(input.email),name=A.validateName(input.name);
        const password=await A.hashPassword(input.password);
        // Never disclose whether the address already has an account.
        if (!db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
          const id=randomUUID();
          db.prepare(`INSERT INTO users(id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)`).run(id,email,name,password,new Date().toISOString());
          A.audit(db,id,id,'account.register');
        }
        return json(res,202,{message:'Solicitud recibida. Si es una cuenta nueva, un administrador debe aprobarla. Si ya tienes cuenta, inicia sesión.'});
      }
      if (route==='/api/v1/auth/login' && req.method==='POST') {
        const input=await body(req),email=A.emailOf(input.email);
        A.rateLimit(db,'login-ip:'+req.socket.remoteAddress,30); A.rateLimit(db,'login-email:'+A.digest(email),10);
        const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (!await A.verifyPassword(input.password,user?.password_hash) || user.status==='disabled') A.bad('Correo o contraseña incorrectos.',401);
        setSession(req,res,user.id);A.audit(db,user.id,user.id,'session.login');
        return json(res,200,{user:A.publicUser(user)});
      }
      if (route==='/api/v1/auth/logout' && req.method==='POST') {
        const token=cookies(req)[cookieName];if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(A.digest(token));
        res.setHeader('Set-Cookie',cookie(cookieName,'',0));return json(res,200,{ok:true});
      }
      if (route==='/api/v1/auth/google' && req.method==='GET') {
        if (!googleReady) return redirect(res,'/?auth_error=google_unavailable');
        A.rateLimit(db,'google:'+req.socket.remoteAddress,30);
        const state=A.secret(),binding=A.secret(),nonce=A.secret(),verifier=A.secret();
        db.prepare('DELETE FROM oauth_states WHERE expires_at<=?').run(Date.now());
        db.prepare('INSERT INTO oauth_states VALUES (?,?,?,?,?)').run(A.digest(state),A.digest(binding),nonce,verifier,Date.now()+600000);
        res.setHeader('Set-Cookie',cookie(oauthCookie,binding,600));
        const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');
        target.search=new URLSearchParams({client_id:clientId,redirect_uri:callback,response_type:'code',scope:'openid email profile',state,nonce,prompt:'select_account',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
        return redirect(res,target.toString());
      }
      if (route==='/api/v1/auth/google/callback' && req.method==='GET') {
        if (!googleReady) return redirect(res,'/?auth_error=google_unavailable');
        const state=db.prepare('SELECT * FROM oauth_states WHERE state_hash=?').get(A.digest(url.searchParams.get('state')||''));
        res.setHeader('Set-Cookie',cookie(oauthCookie,'',0));
        if (!state || state.expires_at<Date.now() || state.binding_hash!==A.digest(cookies(req)[oauthCookie]||'')) return redirect(res,'/?auth_error=google_failed');
        db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(state.state_hash);
        if (url.searchParams.has('error') || !url.searchParams.get('code')) return redirect(res,'/?auth_error=google_cancelled');
        try {
          const {tokens}=await google.getToken({code:url.searchParams.get('code'),codeVerifier:state.verifier,redirect_uri:callback});
          const ticket=await google.verifyIdToken({idToken:tokens.id_token,audience:clientId});
          const claims=ticket.getPayload();
          if (!claims || !claims.email_verified || claims.nonce!==state.nonce || !claims.sub) throw new Error('Invalid Google identity');
          const email=A.validateEmail(claims.email);
          let user=db.prepare('SELECT * FROM users WHERE google_sub=?').get(claims.sub);
          if (!user) {
            // Do not silently link a password account based only on matching email.
            if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return redirect(res,'/?auth_error=account_exists');
            const id=randomUUID(), name=String(claims.name||email.split('@')[0]).slice(0,80);
            db.prepare('INSERT INTO users(id,email,name,google_sub,created_at) VALUES (?,?,?,?,?)').run(id,email,name,claims.sub,new Date().toISOString());
            user=db.prepare('SELECT * FROM users WHERE id=?').get(id);A.audit(db,id,id,'account.google.register');
          }
          if(user.status==='disabled')return redirect(res,'/?auth_error=account_disabled');
          user=A.applyGoogleApproval(db,user);
          setSession(req,res,user.id);
          // Clear the transaction cookie as well as setting the new session.
          res.setHeader('Set-Cookie',[res.getHeader('Set-Cookie'),cookie(oauthCookie,'',0)]);
          A.audit(db,user.id,user.id,'session.google');return redirect(res,'/');
        } catch { return redirect(res,'/?auth_error=google_failed'); }
      }
      if (route==='/api/v1/me' && req.method==='GET') return json(res,200,{user:A.publicUser(authenticate(req))});
      if (route==='/api/v1/me' && req.method==='PATCH') {
        const user=authenticate(req),input=await body(req),name=A.validateName(input.name);
        if(typeof input.department!=='string'||input.department.length>80||typeof input.phone!=='string'||input.phone.length>30)A.bad('Revisa el departamento y teléfono.');
        if(Object.keys(input).some(k=>!['name','department','phone'].includes(k)))A.bad('Solo puedes editar tus datos de perfil.');
        db.prepare('UPDATE users SET name=?,department=?,phone=? WHERE id=?').run(name,input.department.trim(),input.phone.trim(),user.id);
        A.audit(db,user.id,user.id,'profile.update');return json(res,200,{user:A.publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id))});
      }
      if (route==='/api/v1/me/password' && req.method==='POST') {
        const user=authenticate(req),input=await body(req);A.rateLimit(db,'password:'+user.id,5);
        if(!user.password_hash)A.bad('Esta cuenta administra su contraseña en Google.');
        if(!await A.verifyPassword(input.currentPassword,user.password_hash))A.bad('La contraseña actual no es correcta.',400);
        const hash=await A.hashPassword(input.newPassword);
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,user.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);setSession(req,res,user.id);
        A.audit(db,user.id,user.id,'password.change');return json(res,200,{ok:true});
      }
      if(route==='/api/v1/email-approvals') {
        const actor=authenticate(req,true);if(actor.role!=='administrador')A.bad('Se requieren permisos de administrador.',403);
        if(req.method==='GET')return json(res,200,{approvals:db.prepare('SELECT email,role,created_at FROM email_approvals ORDER BY created_at DESC').all()});
        if(req.method==='POST' || req.method==='DELETE') {
          const input=await body(req),email=A.validateEmail(input.email);
          if(req.method==='POST') {
            if(!A.ROLES.includes(input.role))A.bad('Perfil inválido.');
            if(db.prepare('SELECT id FROM users WHERE email=?').get(email))A.bad('Este correo ya está registrado. Modifica su estado en la lista de usuarios.',409);
            db.prepare('INSERT INTO email_approvals VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role,approved_by=excluded.approved_by,created_at=excluded.created_at').run(email,input.role,actor.id,new Date().toISOString());
          } else db.prepare('DELETE FROM email_approvals WHERE email=?').run(email);
          A.audit(db,actor.id,null,req.method==='POST'?'access.email.approved':'access.email.revoked',{email});
          return json(res,200,{ok:true});
        }
        A.bad('Método no permitido.',405);
      }
      if(route==='/api/v1/users' || /^\/api\/v1\/users\/[^/]+$/.test(route)) {
        const actor=authenticate(req,true);if(actor.role!=='administrador')A.bad('Se requieren permisos de administrador.',403);
        if(route==='/api/v1/users' && req.method==='GET')return json(res,200,{users:db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(A.publicUser)});
        if(req.method==='PATCH' && route!=='/api/v1/users') {
          const id=route.split('/').pop(),input=await body(req);
          if(!A.ROLES.includes(input.role)||!A.STATUSES.includes(input.status)||Object.keys(input).some(k=>!['role','status'].includes(k)))A.bad('Rol o estado inválido.');
          const target=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!target)A.bad('Usuario no encontrado.',404);
          db.exec('BEGIN IMMEDIATE');
          try {
            if(target.role==='administrador'&&target.status==='active'&&(input.role!=='administrador'||input.status!=='active')&&db.prepare("SELECT count(*) AS n FROM users WHERE role='administrador' AND status='active'").get().n<=1)A.bad('Debes conservar al menos un administrador activo.',409);
            db.prepare('UPDATE users SET role=?,status=? WHERE id=?').run(input.role,input.status,id);
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
            db.prepare('DELETE FROM email_approvals WHERE email=?').run(target.email);
            A.audit(db,actor.id,id,'access.update',{role:input.role,status:input.status});db.exec('COMMIT');
          }catch(error){db.exec('ROLLBACK');throw error;}
          return json(res,200,{user:A.publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id))});
        }
        A.bad('Método no permitido.',405);
      }
      if(route.startsWith('/api/'))A.bad('Endpoint no encontrado.',404);
      if(!['GET','HEAD'].includes(req.method))A.bad('Método no permitido.',405);
      const allowed={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/auth.css':'auth.css','/auth.js':'auth.js','/app.js':'app.js'};
      if(!allowed[route])A.bad('Archivo no encontrado.',404);
      // The operational bundle is never delivered to anonymous or pending users.
      if(route==='/app.js')authenticate(req,true);
      const filename=allowed[route],content=fs.readFileSync(path.join(__dirname,'dist',filename));
      const type=filename.endsWith('.css')?'text/css':filename.endsWith('.js')?'text/javascript':'text/html';
      res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:content);
    } catch(error) { json(res,error.status||500,{error:error.status?error.message:'Ocurrió un error. Intenta de nuevo.'}); }
  });
  server.on('close',()=>db.close());
  return {server,db};
}
if(require.main===module){const {server}=createApp();const port=Number(process.env.PORT||4173);server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`JIDE NOVA CORE: ${process.env.APP_ORIGIN||'http://127.0.0.1:'+port}`));}
module.exports={createApp};
