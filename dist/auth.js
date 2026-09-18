(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const roles = {administrador:'Administrador',compras:'Compras',almacen:'Almacén',consulta:'Consulta'};
  const statuses = {pending:'Pendiente',active:'Activo',disabled:'Desactivado'};
  const initials = name => name.split(/\s+/).slice(0,2).map(n=>n[0]||'').join('').toUpperCase();
  let currentUser = null, authConfig = null, activeTab = 'profile';
  async function api(path,options={}) {
    const response=await fetch('/api/v1'+path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});
    const contentType=response.headers.get('content-type')||'';
    if(!contentType.includes('application/json'))throw new Error('El acceso requiere el servidor de JIDE NOVA CORE. Abre la aplicación desde su servidor, no como archivo estático.');
    const result=await response.json();
    if(!response.ok){const error=new Error(result.error||'No fue posible completar la solicitud.');error.status=response.status;throw error;}
    return result;
  }
  function message(text,success=false,id='auth-message') { const box=$(id);if(box){box.textContent=text;box.className='auth-message'+(success?' success':'');box.hidden=false;} }
  function authShell(content) {
    $('auth-root').hidden=false;document.querySelector('.shell').hidden=true;
    $('auth-root').innerHTML=`<div class="auth-layout"><aside class="auth-story"><div class="auth-brand"><span class="brandmark">J</span> JIDE NOVA CORE</div><section><div class="auth-mini">NEXO / CENTRO DE CONTROL</div><h1>El control de tu operación.<br><em>Empieza contigo.</em></h1><p>Inventarios, trazabilidad y abastecimiento en un solo espacio de trabajo.</p><div class="auth-points"><span>01 / Visibilidad</span><span>02 / Trazabilidad</span><span>03 / Control</span></div></section><footer>JIDE NOVA CORE · Gestión empresarial</footer></aside><section class="auth-card-wrap"><div class="auth-card">${content}<div class="auth-footer-note">Acceso exclusivo para usuarios autorizados.</div></div></section></div>`;
  }
  function login(mode='login') {
    const register=mode==='register';
    authShell(`<p class="eyebrow">BIENVENIDO A NEXO</p><h2>${register?'Solicita tu cuenta':'Inicia sesión'}</h2><p>${register?'Crea tu perfil. Un administrador revisará tu acceso a JIDE NOVA CORE.':'Accede a tu espacio de trabajo y continúa con tu operación.'}</p><div id="auth-message" class="auth-message" hidden role="alert"></div><button id="google-login" class="google-button" ${authConfig?.googleEnabled?'':'disabled'}><span class="google-letter" aria-hidden="true">G</span>Continuar con Google</button>${authConfig?.googleEnabled?'':'<p class="auth-hint">El acceso con Google todavía no está configurado.</p>'}<div class="auth-divider">o continúa con tu correo</div><form id="login-form" class="auth-form">${register?'<label>Nombre completo<input name="name" autocomplete="name" minlength="2" maxlength="80" required placeholder="Tu nombre y apellidos"></label>':''}<label>Correo electrónico<input name="email" type="email" autocomplete="username" maxlength="254" required placeholder="nombre@empresa.com"></label><label>Contraseña<input name="password" type="password" autocomplete="${register?'new-password':'current-password'}" ${register?'minlength="12"':''} maxlength="128" required placeholder="${register?'Al menos 12 caracteres':'Tu contraseña'}"></label><button type="submit" class="auth-submit">${register?'Solicitar acceso':'Iniciar sesión'}</button></form><div class="auth-switch">${register?'¿Ya tienes una cuenta?':'¿Aún no tienes cuenta?'} <button id="switch-auth">${register?'Inicia sesión':'Solicita acceso'}</button></div>${register?'<p class="auth-hint">Tu rol y acceso son asignados por un administrador. Registrar un correo no verifica su propiedad.</p>':'<p class="auth-hint">Si olvidaste tu contraseña, contacta al administrador. La recuperación por correo aún no está disponible.</p>'}`);
    $('switch-auth').onclick=()=>login(register?'login':'register');
    $('google-login').onclick=()=>{if(authConfig?.googleEnabled)location.assign('/api/v1/auth/google');};
    $('login-form').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;$('auth-message').hidden=true;
      try {
        const input=Object.fromEntries(new FormData(form));
        const result=await api(register?'/auth/register':'/auth/login',{method:'POST',body:JSON.stringify(input)});
        if(register){login();message(result.message,true);}else{currentUser=result.user;await enter();}
      }catch(error){message(error.message);}finally{button.disabled=false;}
    };
  }
  async function logout(){try{await api('/auth/logout',{method:'POST',body:'{}'});location.replace('/');}catch(error){message(error.message,false,'profile-message');}}
  function pending() {
    authShell(`<p class="eyebrow">TU CUENTA ESTÁ REGISTRADA</p><h2>Hola, ${escape(currentUser.name.split(' ')[0])}</h2><p>Tu solicitud está pendiente de aprobación.</p><div class="access-box"><p>Un administrador de JIDE NOVA CORE debe verificar tu identidad y asignarte un perfil antes de que puedas acceder a la operación.</p></div><p class="profile-email">${escape(currentUser.email)}</p><div id="auth-message" hidden role="status"></div><button class="auth-submit" id="check-access">Comprobar mi acceso</button><div class="auth-switch"><button id="pending-logout">Cerrar sesión</button></div>`);
    $('pending-logout').onclick=logout;
    $('check-access').onclick=async()=>{try{currentUser=(await api('/me')).user;if(currentUser.status==='active')await enter();else message('Tu solicitud sigue pendiente de aprobación.',true);}catch(error){if(error.status===401){login();message('Tu acceso cambió. Inicia sesión de nuevo.');}else message(error.message);}};
  }
  async function enter() {
    if(currentUser.status!=='active'){pending();return;}
    $('auth-root').hidden=true;document.querySelector('.shell').hidden=false;
    if(!document.querySelector('script[data-operational]')) {
      await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/app.js';script.dataset.operational='true';script.onload=resolve;script.onerror=()=>reject(new Error('No se pudo abrir la aplicación. Inicia sesión de nuevo.'));document.body.append(script);});
    }
    decorate();
  }
  function can(action){return currentUser?.status==='active'&&(currentUser.role==='administrador'||action==='export'||(['movement','waste'].includes(action)&&currentUser.role==='almacen')||(action==='purchase'&&currentUser.role==='compras'));}
  function decorate() {
    if(!currentUser)return;
    document.querySelector('.top-right').innerHTML=`<span class="demo"><i></i>Inventario de demostración</span><button class="user-trigger" id="open-profile" aria-label="Abrir mi perfil"><span class="user-name">${escape(currentUser.name.split(' ')[0])}</span><span class="avatar small">${escape(initials(currentUser.name))}</span></button>`;
    const profile=document.querySelector('.sidebar-bottom .profile');
    if(profile){profile.innerHTML=`<span class="avatar">${escape(initials(currentUser.name))}</span><div><strong>${escape(currentUser.name)}</strong><small>${roles[currentUser.role]}</small></div>`;}
    if(!$('my-profile-link')) {const btn=document.createElement('button');btn.id='my-profile-link';btn.className='nav-item profile-button';btn.textContent='Mi perfil'+(currentUser.role==='administrador'?' y usuarios':'');btn.onclick=()=>openProfile();document.getElementById('navigation').append(btn);}
    $('open-profile').onclick=()=>openProfile();
    document.querySelectorAll('[data-action]').forEach(b=>{b.hidden=!can(b.dataset.action);});
  }
  async function profileBody(tab) {
    activeTab=tab;
    const dialog=$('profile-dialog');
    dialog.innerHTML=`<div class="modal-head"><h2>${tab==='users'?'Usuarios y permisos':'Mi perfil'}</h2><button class="icon-btn" id="close-profile" aria-label="Cerrar perfil">×</button></div><div class="profile-tabs"><button data-profile-tab="profile" class="${tab==='profile'?'active':''}">Datos personales</button><button data-profile-tab="security" class="${tab==='security'?'active':''}">Seguridad</button>${currentUser.role==='administrador'?`<button data-profile-tab="users" class="${tab==='users'?'active':''}">Usuarios</button>`:''}</div><div class="modal-body"><div id="profile-message" hidden role="alert"></div><div id="profile-content"></div></div>`;
    $('close-profile').onclick=()=>dialog.close();dialog.querySelectorAll('[data-profile-tab]').forEach(b=>b.onclick=()=>profileBody(b.dataset.profileTab));
    const container=$('profile-content');
    if(tab==='profile') {
      container.innerHTML=`<div class="profile-meta"><span class="avatar">${escape(initials(currentUser.name))}</span><div><h3>${escape(currentUser.name)}</h3><p class="profile-email">${escape(currentUser.email)}</p><span class="pill">${roles[currentUser.role]}</span></div></div><form id="profile-form" class="auth-form"><label>Nombre completo<input name="name" value="${escape(currentUser.name)}" minlength="2" maxlength="80" required autocomplete="name"></label><div class="form-grid"><label>Departamento<input name="department" value="${escape(currentUser.department)}" maxlength="80" autocomplete="organization-title"></label><label>Teléfono<input name="phone" type="tel" value="${escape(currentUser.phone)}" maxlength="30" autocomplete="tel"></label></div><p class="auth-hint">El correo identifica tu cuenta. Solo un administrador puede cambiar tu rol o estado.</p><button class="auth-submit">Guardar perfil</button></form><div class="auth-switch"><button id="profile-logout">Cerrar sesión</button></div>`;
      $('profile-logout').onclick=logout;
      $('profile-form').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;try{currentUser=(await api('/me',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))})).user;decorate();await profileBody('profile');message('Perfil actualizado.',true,'profile-message');}catch(error){message(error.message,false,'profile-message');}finally{button.disabled=false;}};
    }
    if(tab==='security') {
      container.innerHTML=currentUser.provider==='google'?`<div class="access-box"><p>Tu acceso está vinculado a Google. Administra tu contraseña desde tu cuenta de Google.</p></div><button class="auth-submit" id="profile-logout">Cerrar sesión</button>`:`<p class="auth-hint">Cambiar la contraseña cerrará tus otras sesiones.</p><form id="password-form" class="auth-form"><label>Contraseña actual<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label><label>Nueva contraseña<input name="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label><button class="auth-submit">Actualizar contraseña</button></form>`;
      if($('profile-logout'))$('profile-logout').onclick=logout;
      if($('password-form'))$('password-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;try{await api('/me/password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});f.reset();message('Contraseña actualizada. Las otras sesiones se cerraron.',true,'profile-message');}catch(error){message(error.message,false,'profile-message');}finally{b.disabled=false;}};
    }
    if(tab==='users') {
      container.innerHTML='<p>Cargando usuarios…</p>';
      try {
        const [{users},{approvals}]=await Promise.all([api('/users'),api('/email-approvals')]);if(activeTab!=='users')return;
        container.innerHTML=`<p class="auth-hint">Aprueba únicamente a personas autorizadas de JIDE NOVA CORE. Verifica por otro medio los registros con contraseña: su correo no ha sido verificado. Cambiar el acceso cierra las sesiones del usuario.</p><div class="users-list">${users.map(u=>`<article class="user-card"><div><h3>${escape(u.name)}</h3><p>${escape(u.email)}</p><span class="profile-status">${u.provider==='google'?'Identidad verificada por Google':'Cuenta con contraseña · correo sin verificar'}</span></div><span class="pill ${u.status==='active'?'':'amber'}">${statuses[u.status]}</span><form data-user="${escape(u.id)}"><label class="field">Perfil<select name="role">${Object.entries(roles).map(([v,label])=>`<option value="${v}" ${u.role===v?'selected':''}>${label}</option>`).join('')}</select></label><label class="field">Estado<select name="status">${Object.entries(statuses).map(([v,label])=>`<option value="${v}" ${u.status===v?'selected':''}>${label}</option>`).join('')}</select></label><button class="button primary">Guardar acceso</button></form></article>`).join('')}</div>`;
        container.insertAdjacentHTML('afterbegin',`<section class="access-box"><h3>Aprobar un correo</h3><p>Autoriza una cuenta antes de su primer acceso con Google. No se envía una invitación por correo.</p><form id="approve-email-form" class="auth-form"><label>Correo a aprobar<input name="email" type="email" maxlength="254" required placeholder="persona@empresa.com"></label><label>Perfil asignado<select name="role">${Object.entries(roles).map(([v,label])=>`<option value="${v}" ${v==='consulta'?'selected':''}>${label}</option>`).join('')}</select></label><button class="auth-submit">Aprobar correo</button></form><p>Si Google restringe el acceso porque la aplicación está en pruebas, el correo también debe estar habilitado en Google Cloud. Las cuentas con contraseña requieren aprobación manual después del registro.</p></section><h3>Correos aprobados por registrar</h3><div class="users-list">${approvals.length?approvals.map(a=>`<article class="user-card"><div><p>${escape(a.email)}</p><span class="pill">${roles[a.role]}</span></div><button class="button" data-revoke-email="${escape(a.email)}">Revocar aprobación</button></article>`).join(''):'<p class="auth-hint">No hay aprobaciones anticipadas.</p>'}</div><h3>Usuarios registrados · ${users.filter(u=>u.status==='pending').length} pendientes</h3>`);
        $('approve-email-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,b=form.querySelector('button');b.disabled=true;try{await api('/email-approvals',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});await profileBody('users');message('Correo aprobado. Podrá entrar cuando Google verifique su identidad.',true,'profile-message');}catch(error){message(error.message,false,'profile-message');}finally{b.disabled=false;}};
        container.querySelectorAll('[data-revoke-email]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/email-approvals',{method:'DELETE',body:JSON.stringify({email:b.dataset.revokeEmail})});await profileBody('users');message('Aprobación revocada.',true,'profile-message');}catch(error){message(error.message,false,'profile-message');}finally{b.disabled=false;}});
        container.querySelectorAll('[data-user]').forEach(form=>form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await api('/users/'+encodeURIComponent(form.dataset.user),{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(form)))});if(form.dataset.user===currentUser.id){location.replace('/');return;}await profileBody('users');message('Acceso actualizado. El usuario debe iniciar sesión de nuevo.',true,'profile-message');}catch(error){message(error.message,false,'profile-message');}finally{button.disabled=false;}});
      }catch(error){container.textContent='';message(error.message,false,'profile-message');}
    }
  }
  async function openProfile(){const d=$('profile-dialog');if(!d.open)d.showModal();await profileBody('profile');}
  window.nexoAuth={decorate,can};
  document.addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(button&&!can(button.dataset.action)){e.preventDefault();e.stopImmediatePropagation();}},true);
  async function boot() {
    try {
      authConfig=await api('/auth/config');
      const errors={google_unavailable:'El acceso con Google aún no está configurado.',google_failed:'No se pudo verificar el acceso con Google. Intenta de nuevo.',google_cancelled:'Se canceló el acceso con Google.',account_exists:'Ya existe una cuenta con ese correo. Accede con tu contraseña; no se vinculó automáticamente a Google.',account_disabled:'Esta cuenta está desactivada. Contacta al administrador.'};
      const code=new URLSearchParams(location.search).get('auth_error');
      if(code){history.replaceState(null,'','/');login();message(errors[code]||'No se pudo iniciar sesión.');return;}
      try{currentUser=(await api('/me')).user;await enter();}catch(error){if(error.status===401)login();else throw error;}
    }catch(error){authShell(`<h2>No se pudo conectar</h2><p>${escape(error.message)}</p><button id="auth-retry" class="auth-submit">Reintentar</button>`);$('auth-retry').onclick=()=>location.reload();}
  }
  boot();
})();
