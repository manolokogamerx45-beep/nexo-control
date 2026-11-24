(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=v=>new Intl.NumberFormat('es-MX',{maximumFractionDigits:3}).format(v/1000);
  const date=v=>v?new Date(v).toLocaleString('es-MX'):'—',day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const offline={on:false,syncedAt:0,queue:[],loaded:false,flushing:false,notice:false};
  let state,route='overview',query='',warehouse='',page=0,loadVersion=0,metricsData=null,metricsMonths=6,metricsError='',metricsVersion=0;
  const navigation=[['overview','Resumen'],['alerts','Alertas'],['metrics','Indicadores'],['inventory','Inventario'],['articles','Artículos'],['requests','Solicitudes de abastecimiento'],['lots','Lotes y trazabilidad'],['movements','Movimientos'],['kardex','Kardex'],['transfers','Transferencias'],['returns','Devoluciones'],['waste','Mermas'],['counts','Conteos cíclicos'],['replenish','Sugerencias de compra'],['purchases','Compras a proveedores'],['partners','Empresas y puntos de venta'],['warehouses','Almacenes'],['audit','Bitácora'],['company','Mi empresa']];
  const allow=(...roles)=>state?.role==='administrador'||roles.includes(state?.role);
  const article=id=>state.articles.find(x=>x.id===id),wh=id=>state.warehouses.find(x=>x.id===id)?.name||'—',partner=id=>state.partners.find(x=>x.id===id)?.name||'—';
  const requestItems=r=>Array.isArray(r.items)?r.items:[{articleId:r.articleId,quantity:r.quantity,allocations:r.allocations||[]}];
  const purchaseItems=p=>Array.isArray(p.items)?p.items:[{articleId:p.articleId,quantity:p.quantity,received:p.received||0}];
  const returnable=b=>state.events.filter(e=>e.batchId===b.id&&['Salida PEPS','Despacho','Despacho parcial'].includes(e.type)).reduce((n,e)=>n+e.qty,0)-state.events.filter(e=>e.sourceBatchId===b.id&&e.type==='Devolución de cliente').reduce((n,e)=>n+e.qty,0);
  const button=(label,op,id='',primary=false)=>`<button type="button" class="button ${primary?'primary':''}" data-op="${op}" data-id="${esc(id)}">${label}</button>`;
  const pill=v=>`<span class="pill ${['Pendiente','Caducado','Stock bajo','Cancelada'].includes(v)?'amber':''}">${esc(v)}</span>`;
  const table=(headers,rows)=>`<section class="panel"><div class="table-scroll" tabindex="0"><table role="table"><thead><tr>${headers.map(h=>`<th role="columnheader" scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(cells=>`<tr role="row">${cells.map((c,i)=>`<td role="cell" data-label="${headers[i]}"><div class="cell-value">${c}</div></td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}" class="empty">Aún no hay registros. Usa las acciones de esta pantalla para comenzar.</td></tr>`}</tbody></table></div></section>`;
  const idb=window.nexoOffline,me=()=>window.nexoAuth?.user()?.id||'';
  async function request(path,method,body){
    let r;
    try{r=await fetch('/api/v1/operations'+path,{method,credentials:'same-origin',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
    catch{const failure=Error('No se pudo conectar con el servidor.');failure.offline=true;throw failure;}
    let data={};try{data=await r.json();}catch{}
    if(!r.ok){const failure=Error(data.error||'No se pudo completar la operación.');failure.status=r.status;throw failure;}
    return data;
  }
  const labels={'receipts':'Recepción de mercancía','issues':'Salida PEPS','transfers':'Transferencia','waste':'Merma','counts':'Conteo físico','returns':'Devolución','purchases':'Compra a proveedor','requests':'Solicitud','articles':'Artículo','inventory':'Importación de existencias','policies':'Stock mínimo','warehouses':'Almacén','partners':'Empresa','company':'Datos de la empresa','count-sessions':'Conteo cíclico','batches':'Ubicación de lote'};
  const describe=(path,method)=>(labels[path.split('/')[1]]||'Operación')+(method==='PATCH'&&path.split('/').length>2?' (actualización)':'');
  async function enqueue(path,method,payload){
    await idb.put({id:payload._operationId,userId:me(),method,path,body:payload,label:describe(path,method),at:Date.now()});
    offline.queue=await idb.queue();offline.on=true;offline.notice=true;
    return {queued:true,id:payload._operationId};
  }
  // Sends queued operations in order. A lost connection stops the run; a rejection is kept for review.
  async function flush(){
    if(offline.flushing)return;offline.flushing=true;
    try{
      for(const op of await idb.queue()){
        if(op.error||op.userId!==me())continue;
        try{await request(op.path,op.method,op.body);await idb.remove(op.id);offline.on=false;}
        catch(e){if(e.offline){offline.on=true;break;}if(e.status===401)break;op.error=e.message;await idb.put(op).catch(()=>{});}
      }
    }finally{offline.flushing=false;offline.queue=await idb.queue();}
  }
  async function api(path,method='GET',body){
    if(method==='GET'){
      try{const data=await request(path,method);offline.on=false;await idb.set('get:'+path,{at:Date.now(),userId:me(),data});return data;}
      catch(e){
        if(!e.offline)throw e;
        const hit=await idb.get('get:'+path);
        if(hit&&hit.userId===me()){offline.on=true;if(path==='/snapshot')offline.syncedAt=hit.at;return hit.data;}
        throw Error('Sin conexión y todavía no hay datos guardados en este dispositivo. Conéctate una vez para descargarlos.');
      }
    }
    const payload={...(body||{}),_operationId:body?._operationId||crypto.randomUUID()};
    if(offline.queue.length)await flush();
    // Never jump ahead of work that is still waiting to be sent.
    if(!offline.queue.some(op=>!op.error)){
      try{const data=await request(path,method,payload);offline.on=false;return data;}
      catch(e){if(!e.offline)throw e;}
    }
    return enqueue(path,method,payload);
  }
  let timer;function toast(msg){if(offline.notice){msg='Sin conexión: guardado en este dispositivo. Se enviará al reconectar.';offline.notice=false;}clearTimeout(timer);$('toast').textContent=msg;$('toast').classList.add('visible');timer=setTimeout(()=>$('toast').classList.remove('visible'),6000);}
  const ago=t=>{const m=Math.round((Date.now()-t)/60000);return !t?'nunca':m<1?'hace un momento':m<60?`hace ${m} min`:m<1440?`hace ${Math.round(m/60)} h`:`hace ${Math.round(m/1440)} d`;};
  function offlineBanner(){
    const waiting=offline.queue.filter(o=>!o.error).length,rejected=offline.queue.filter(o=>o.error).length;
    if(!offline.on&&!waiting&&!rejected)return '';
    const text=[offline.on?`Sin conexión · datos de ${ago(offline.syncedAt)}`:'Conectado',waiting?`${waiting} operación(es) por enviar`:'',rejected?`${rejected} rechazada(s) por el servidor`:''].filter(Boolean).join(' · ');
    return `<div class="offline-banner ${offline.on||rejected?'warn':''}" role="status"><span>${esc(text)}</span><span class="offline-actions">${button('Reintentar','sync')}${offline.queue.length?button('Ver pendientes','pending'):''}</span></div>`;
  }
  function pendingList(){
    modal('Operaciones por enviar',offline.queue.length?`<div class="table-scroll">${offline.queue.map(op=>`<div class="pending-op"><strong>${esc(op.label)}</strong><span>${esc(date(op.at))}</span>${op.error?`<span class="pending-error">Rechazada: ${esc(op.error)}</span>`:'<span>Pendiente de enviar</span>'}${button(op.error?'Quitar de la lista':'Descartar','discard-op',op.id)}</div>`).join('')}</div>`:'<p>No hay operaciones pendientes.</p>');
  }
  function totals(a,w){const batches=state.batches.filter(b=>b.articleId===a&&(!w||b.warehouseId===w));return {physical:batches.reduce((s,b)=>s+b.quantity,0),reserved:batches.reduce((s,b)=>s+b.reserved,0),available:batches.reduce((s,b)=>s+(!b.expiry||b.expiry>=day()?b.quantity-b.reserved:0),0)};}
  function branding(){const c=state.company;document.querySelector('.workspace strong').textContent=c.name;document.querySelector('.company-avatar').innerHTML=c.logo?`<img src="${esc(c.logo)}" alt="Logo de ${esc(c.name)}" style="width:100%;height:100%;object-fit:contain">`:esc(c.name.slice(0,1));document.querySelector('.brand').innerHTML=c.logo?`<img src="${esc(c.logo)}" alt="" style="width:38px;height:38px;object-fit:contain"> ${esc(c.name)}`:esc(c.name);document.querySelector('.main-wrap footer').innerHTML=`${esc(c.name)} <span>Inventario guardado en el servidor</span><strong>Tecnología JIDE NOVA CORE · Nexo</strong>`;document.title=(navigation.find(n=>n[0]===route)?.[1]||'Nexo')+' | '+c.name;}
  function render(){
    const nav=state.role==='solicitante'?navigation.filter(n=>['overview','articles','requests'].includes(n[0])):navigation.filter(n=>!['company','audit'].includes(n[0])||allow());
    if(!nav.some(n=>n[0]===route))route='overview';
    $('navigation').innerHTML=nav.map(([id,label])=>`<a href="#${id}" class="nav-item ${route===id?'active':''}" ${route===id?'aria-current="page"':''}>${esc(label)}</a>`).join('');
    $('crumb').textContent=nav.find(n=>n[0]===route)[1];
    const stockActions=allow('almacen')?button('Recibir mercancía','receipt','',true)+' '+button('Importar existencias','import-inventory')+' '+button('Transferir','transfer')+' '+button('Conteo físico','count')+' '+button('Salida PEPS','issue'):'';
    const actions={articles:allow('compras')?button('Nuevo artículo','article','',true)+' '+button('Importar CSV','import-articles'):'',requests:allow('solicitante','compras','almacen')?button('Nueva solicitud','request','',true):'',inventory:stockActions,movements:stockActions,transfers:allow('almacen')?button('Nueva transferencia','transfer','',true):'',returns:allow('almacen')?button('Recibir de cliente','customer-return','',true)+' '+button('Devolver a proveedor','supplier-return'):'',waste:allow('almacen')?button('Registrar merma','waste','',true):'',counts:allow('almacen')?button('Nuevo conteo','count-new','',true):'',warehouses:allow()?button('Nuevo almacén','warehouse','',true):'',partners:allow('compras')?button('Agregar empresa','partner','',true):'',purchases:allow('compras')?button('Nueva compra','purchase','',true):'',company:button('Editar nombre y logo','company','',true)};
    let html=offlineBanner()+`<div class="page-head"><div><p class="eyebrow">ALMACENAMIENTO Y ABASTECIMIENTO</p><h1 tabindex="-1">${nav.find(n=>n[0]===route)[1]}</h1><p class="subtitle">${route==='requests'?'Del punto de venta al almacén: solicitud, reserva, despacho y recepción.':'Control de artículos, existencias y entregas por lote.'}</p></div><div class="head-actions">${actions[route]||''}${state.role!=='solicitante'?button('Escanear','scan'):''}${button('Actualizar','refresh')}</div></div>`;
    if(route==='overview'){
      const low=lowStock(),soon=expiring(30);
      html+=`<div class="metrics">${[['Artículos',state.articles.filter(a=>a.active).length],['Almacenes',state.warehouses.length],['Solicitudes pendientes',state.requests.filter(r=>r.status==='Pendiente').length],['Alertas de stock bajo',low.length],['Caducan en 30 días',soon.length]].map(([l,n])=>`<div class="metric"><div class="metric-top">${l}</div><div class="metric-value">${n}</div></div>`).join('')}</div><section class="panel onboarding"><h2>Tu operación, paso a paso</h2><p class="subtitle">Configura almacenes y empresas → crea artículos → recibe lotes → atiende solicitudes → consulta las entregas.</p><p>PEPS selecciona primero la recepción más antigua disponible. Los lotes caducados y las reservas se excluyen del disponible.</p>${state.articles.length?'':'<p>El catálogo está vacío. Los datos ilustrativos anteriores no se han convertido en existencias reales.</p>'}</section>`;
      html+=table(['Alerta','Artículo','Almacén','Detalle'],[...low.map(p=>[pill('Stock bajo'),esc(article(p.articleId)?.name),esc(wh(p.warehouseId)),`${number(totals(p.articleId,p.warehouseId).available)} disponibles; mínimo ${number(p.minimum)} ${esc(article(p.articleId)?.unit)}`]),...soon.map(x=>{const [label,cls]=urgency(x.days);return[tag(label,cls),esc(article(x.b.articleId)?.name),esc(wh(x.b.warehouseId)),`Lote ${esc(x.b.lot)} · ${esc(shortDate(x.b.expiry))} (${esc(whenText(x.days))})`];})])+(soon.length||low.length?`<p class="note"><a href="#alerts">Ver todas las alertas y acciones sugeridas →</a></p>`:'');
    }
    if(route==='metrics')html+=metricsView();
    if(route==='alerts')html+=alertsView();
    if(route==='kardex')html+=kardexView();
    if(route==='replenish')html+=replenishView();
    if(route==='counts')html+=countsView();
    if(route==='audit')html+=auditView();
    if(route==='articles')html+=table(['SKU / artículo','Código de barras','Tipo','Unidad','Proveedor / entrega / empaque','Estado','Acciones'],state.articles.map(a=>[`${esc(a.sku)}<br><strong>${esc(a.name)}</strong>`,a.barcode?esc(a.barcode):'—',esc(a.kind),esc(a.unit),a.preferredPartnerId||a.leadTimeDays!=null||a.packSize?`${esc(a.preferredPartnerId?partner(a.preferredPartnerId):'—')}<br>${a.leadTimeDays!=null?esc(a.leadTimeDays+' días'):''}${a.packSize?`<br><small>${esc(packLabel(a))}</small>`:''}`:'—',pill(a.active?'Activo':'Desactivado'),`<div class="row-actions">${allow('compras')?button('Editar','edit-article',a.id):''}${state.role!=='solicitante'?button('Etiqueta','label-article',a.id):''}</div>`]));
    if(route==='inventory'){
      const rows=state.articles.flatMap(a=>state.warehouses.map(w=>({a,w,...totals(a.id,w.id),policy:state.policies.find(p=>p.articleId===a.id&&p.warehouseId===w.id)}))).filter(x=>(!warehouse||x.w.id===warehouse)&&`${x.a.sku} ${x.a.name}`.toLowerCase().includes(query.toLowerCase()));
      const pages=Math.max(1,Math.ceil(rows.length/30));page=Math.min(page,pages-1);
      html+=`<div class="toolbar"><input id="search" class="filter" aria-label="Buscar artículo o SKU" placeholder="Buscar artículo o SKU" value="${esc(query)}"><select id="warehouse-filter" class="filter" aria-label="Filtrar almacén"><option value="">Todos los almacenes</option>${state.warehouses.map(w=>`<option value="${w.id}" ${warehouse===w.id?'selected':''}>${esc(w.name)}</option>`).join('')}</select>${allow('almacen')?button('Configurar mínimo','policy'):''}${button('Hoja de conteo','count-sheet')}${button('Exportar CSV','export')}</div>`;
      html+=table(['Artículo','Almacén','Físico','Reservado','Disponible','Mínimo / estado'],rows.slice(page*30,page*30+30).map(x=>[`${esc(x.a.sku)} · ${esc(x.a.name)}`,esc(x.w.name),`${number(x.physical)} ${esc(x.a.unit)}`,number(x.reserved),number(x.available),x.policy?`${number(x.policy.minimum)} · ${pill(x.available<x.policy.minimum?'Stock bajo':'Suficiente')}`:'Sin configurar']));
      html+=`<div class="toolbar">${page?button('Anterior','previous'):''}<span>${rows.length} resultados · Página ${page+1} de ${pages}</span>${page+1<pages?button('Siguiente','next'):''}</div><p class="note">Stock bajo: disponible menor al mínimo por artículo y almacén. Físico incluye mercancía caducada; disponible la excluye.</p>`;
    }
    if(route==='lots')html+=table(['Artículo / lote','Almacén','Ubicación','Entrada','Caducidad','Existencia','Recorrido'],state.batches.map(b=>[`${esc(article(b.articleId)?.name)}<br>${esc(b.lot)}`,esc(wh(b.warehouseId)),esc(b.location||'—'),date(b.receivedAt),b.expiry?`${esc(b.expiry)} ${b.expiry<day()?pill('Caducado'):''}`:'No aplica',`${number(b.quantity)} ${esc(article(b.articleId)?.unit)}`,`<div class="row-actions">${button('Ver trazabilidad','trace',b.id)}${button('Etiqueta','label-batch',b.id)}${allow('almacen')?button('Ubicar','locate',b.id):''}</div>`]));
    if(['movements','returns','waste'].includes(route))html+=table(['Fecha / responsable','Tipo','Artículo / lote','Cantidad','Origen / destino','Referencia','Documento'],state.events.filter(e=>route==='waste'?e.type==='Merma':route==='returns'?e.type.startsWith('Devolución'):true).map(e=>{const b=state.batches.find(b=>b.id===e.batchId),a=article(e.articleId),place=e.destinationWarehouseId?`${esc(wh(e.warehouseId))} → ${esc(wh(e.destinationWarehouseId))}`:e.sourceWarehouseId?`${esc(wh(e.sourceWarehouseId))} → ${esc(wh(e.warehouseId))}`:`${esc(wh(e.warehouseId))}<br>${esc(e.destination||partner(e.partnerId))}`;return[`${date(e.at)}<br>${esc(e.actorName)}`,pill(e.type),`${esc(a?.name)}<br>${esc(b?.lot)}`,`${number(e.qty)} ${esc(a?.unit)}`,place,esc(e.reference),button('Imprimir','print-event',e.id)];}));
    if(route==='requests')html+=table(['Solicitud','Solicitante / destino','Artículos / cantidades','Almacén','Estado','Acciones'],state.requests.map(r=>{const items=requestItems(r),summary=items.map(item=>`${esc(article(item.articleId)?.name)} · ${number(item.quantity)} ${esc(article(item.articleId)?.unit)}`).join('<br>');let actions=button('Historial','request-detail',r.id);if(allow('almacen')){if(r.status==='Pendiente')actions+=button('Aprobar y reservar','approve',r.id);if(['Aprobada','Parcialmente despachada'].includes(r.status))actions+=button('Despachar','dispatch',r.id)+button('Lista de surtido','print-picking',r.id);if(['Pendiente','Aprobada','Parcialmente despachada'].includes(r.status))actions+=button('Cancelar','cancel',r.id);}if(r.status==='Despachada'&&(allow()||r.createdBy===state.userId))actions+=button('Confirmar recepción','receive',r.id);if(state.role!=='solicitante'&&state.events.some(e=>e.requestId===r.id&&['Despacho parcial','Despacho'].includes(e.type)))actions+=button('Remisión','print-remission',r.id);return[`${esc(r.reference)}<br>${date(r.createdAt)}`,`${esc(r.createdByName)}<br>${esc(r.destination)}`,summary,esc(wh(r.warehouseId)),pill(r.status),actions];}));
    if(route==='transfers')html+=`<p class="note">Preparar reserva el inventario; enviar lo descuenta del origen; recibirlo crea las existencias en el destino.</p>`+table(['Referencia / fecha','Artículo / cantidad','Ruta','Estado','Acciones'],state.transfers.map(t=>{let actions='—';if(allow('almacen')){actions='';if(t.status==='Preparada')actions=button('Enviar','transfer-send',t.id)+button('Cancelar','transfer-cancel',t.id);if(t.status==='Enviada')actions=button('Recibir','transfer-receive',t.id)+button('Rechazar','transfer-reject',t.id);}return[`${esc(t.reference)}<br>${date(t.createdAt)}`,`${esc(article(t.articleId)?.name)}<br>${number(t.quantity)} ${esc(article(t.articleId)?.unit)}`,`${esc(wh(t.sourceWarehouseId))} → ${esc(wh(t.destinationWarehouseId))}`,pill(t.status),actions];}));
    if(route==='purchases')html+=`<p class="note">Las compras abastecen al almacén desde proveedores. Cada orden puede recibirse por artículo y en varias entregas.</p>`+table(['Referencia','Proveedor','Artículos','Pedido / recibido','Estado','Acciones'],state.purchases.map(p=>{const items=purchaseItems(p),names=items.map(item=>esc(article(item.articleId)?.name)).join('<br>'),progress=items.map(item=>`${number(item.quantity)} / ${number(item.received)} ${esc(article(item.articleId)?.unit)}`).join('<br>');return[esc(p.reference),esc(partner(p.partnerId)),names,progress,pill(p.status),`<div class="row-actions">${allow('almacen')&&items.some(item=>item.received<item.quantity)?button('Recibir','receive-purchase',p.id):''}${button('Imprimir','print-purchase',p.id)}</div>`];}));
    if(route==='partners')html+=table(['Empresa / punto de venta','Tipo','Referencia / dirección'],state.partners.map(p=>[esc(p.name),pill(p.kind),esc(p.reference)]));
    if(route==='warehouses')html+=table(['Almacén','Ubicación'],state.warehouses.map(w=>[esc(w.name),esc(w.location)]));
    if(route==='company')html+=`<section class="panel onboarding"><h2>${esc(state.company.name)}</h2>${state.company.logo?`<img src="${esc(state.company.logo)}" alt="Logo del cliente" style="max-width:180px;max-height:120px">`:'<p>Aún no has cargado el logo del cliente.</p>'}<p>Esta instalación corresponde a una empresa. Sus clientes y puntos de venta se registran como destinatarios.</p></section>`;
    $('main').innerHTML=html;window.nexoAuth?.decorate();branding();ensureBell();
    $('search')?.addEventListener('input',e=>{query=e.target.value;page=0;const pos=e.target.selectionStart;render();$('search').focus();$('search').setSelectionRange(pos,pos);});
    $('warehouse-filter')?.addEventListener('change',e=>{warehouse=e.target.value;page=0;render();});
    $('metrics-period')?.addEventListener('change',e=>{metricsMonths=Number(e.target.value);metricsError='';render();});
    $('expiry-window')?.addEventListener('change',e=>{expiryWindow=Number(e.target.value);render();});
    for(const [id,key] of [['kardex-article','articleId'],['kardex-warehouse','warehouseId'],['kardex-from','from'],['kardex-to','to']])$(id)?.addEventListener('change',e=>{kardex[key]=e.target.value;render();});
    for(const [id,key,min,max] of [['replenish-safety','safety',0,120],['replenish-cover','cover',1,365]])$(id)?.addEventListener('change',e=>{const n=Math.round(Number(e.target.value));replenish[key]=Number.isFinite(n)?Math.min(max,Math.max(min,n)):replenish[key];render();});
    $('replenish-all')?.addEventListener('change',e=>{replenish.all=e.target.checked;render();});
    for(const [id,key] of [['audit-actor','actor'],['audit-kind','kind']])$(id)?.addEventListener('change',e=>{auditFilter[key]=e.target.value;render();});
    $('audit-q')?.addEventListener('input',e=>{auditFilter.q=e.target.value;const pos=e.target.selectionStart;render();$('audit-q').focus();$('audit-q').setSelectionRange(pos,pos);});
  }
  const money=(v,compact=false)=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',...(compact?{notation:'compact',maximumFractionDigits:1}:{maximumFractionDigits:2})}).format(v);
  const monthName=key=>new Date(key+'-15T12:00:00Z').toLocaleDateString('es-MX',{month:'short',year:'2-digit',timeZone:'UTC'}).replace(' ',' ');
  const times=v=>v==null?'—':new Intl.NumberFormat('es-MX',{maximumFractionDigits:2}).format(v)+'×';
  async function loadMetrics(){const version=++metricsVersion;try{const data=await api('/metrics/'+metricsMonths);if(version!==metricsVersion)return;metricsData=data;metricsError='';}catch(e){if(version!==metricsVersion)return;metricsError=e.message;}if(route==='metrics')render();}
  function niceMax(v){if(v<=0)return 1;const p=10**Math.floor(Math.log10(v)),n=v/p;return(n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p;}
  // Single-series column chart; the monthly table below carries every exact value.
  function columns(title,note,points,format,axisFormat=format){
    const top=niceMax(Math.max(0,...points.map(p=>p.value))),ticks=[0,.25,.5,.75,1].map(f=>top*f),last=points.length-1;
    return `<section class="panel mchart-panel"><div class="panel-head"><div><h2>${esc(title)}</h2><p>${esc(note)}</p></div></div><div class="mchart${points.length>6?' dense':''}" role="img" aria-label="${esc(title+': '+points.map(p=>p.label+' '+format(p.value)).join(', '))}"><div class="mchart-axis" aria-hidden="true">${ticks.slice().reverse().map(t=>`<span>${esc(axisFormat(t))}</span>`).join('')}</div><div class="mchart-plot">${ticks.slice(1).map(t=>`<i class="mchart-grid" style="bottom:${t/top*100}%"></i>`).join('')}${points.map((p,i)=>`<div class="mchart-col" tabindex="0" aria-label="${esc(p.label+': '+format(p.value))}" data-tip="${esc(p.label+' · '+format(p.value))}"><span class="mchart-bar" style="height:${p.value>0?Math.max(1,p.value/top*100):0}%">${i===last?`<b>${esc(format(p.value))}</b>`:''}</span><small aria-hidden="true">${esc(p.label)}</small></div>`).join('')}</div></div></section>`;
  }
  function metricsView(){
    const period=`<div class="toolbar metrics-toolbar"><label class="field inline">Periodo<select id="metrics-period" class="filter">${[3,6,12].map(n=>`<option value="${n}" ${n===metricsMonths?'selected':''}>Últimos ${n} meses</option>`).join('')}</select></label></div>`;
    if(metricsError&&(!metricsData||metricsData.months!==metricsMonths))return period+`<section class="panel onboarding"><h2>No se pudieron calcular los indicadores</h2><p>${esc(metricsError)}</p>${button('Reintentar','metrics-retry')}</section>`;
    if(!metricsData||metricsData.months!==metricsMonths){loadMetrics();return period+'<section class="panel empty" role="status">Calculando indicadores…</section>';}
    const m=metricsData,costed=m.costCoverage.valued>0,pts=(key,fn=x=>x[key])=>m.monthly.map(x=>({label:monthName(x.month),value:fn(x)}));
    const count=v=>new Intl.NumberFormat('es-MX').format(v);
    const coverage=m.costCoverage.total?`${m.costCoverage.valued} de ${m.costCoverage.total} lotes con costo`:'Sin existencias';
    const tile=(label,value,note)=>`<div class="metric"><div class="metric-top">${esc(label)}</div><div class="metric-value">${value}</div><div class="metric-note">${esc(note)}</div></div>`;
    let html=period+`<div class="metrics">${tile('Valor del inventario',costed?esc(money(m.inventoryValue)):'Sin costos',costed?coverage:'Registra el costo unitario al recibir mercancía')}${tile('Movimientos en el periodo',count(m.totals.movements),'Entradas, salidas, mermas, ajustes y transferencias')}${tile('Mermas en el periodo',count(m.totals.waste),costed?'Valor: '+money(m.totals.wasteValue):'Registros de merma')}${tile('Rotación del periodo',costed?times(m.totals.rotation):'—',costed?'Costo de salidas ÷ inventario promedio':'Requiere costos; consulta la rotación por artículo')}</div>`;
    if(costed&&m.costCoverage.valued<m.costCoverage.total)html+=`<p class="note">Hay lotes sin costo unitario: su valor cuenta como $0. Los lotes nuevos toman el costo capturado en la recepción.</p>`;
    html+=`<div class="mchart-layout">`+columns('Movimientos por mes','Registros que cambian existencias',pts('movements',x=>x.movements.total),count);
    html+=costed?columns('Valor del inventario al cierre','Existencias valuadas a costo de recepción',pts('closingValue'),v=>money(v),v=>money(v,true)):'';
    html+=costed?columns('Mermas por mes','Valor a costo de las mermas registradas',pts('wasteValue'),v=>money(v),v=>money(v,true)):columns('Mermas por mes','Número de registros de merma',pts('waste',x=>x.movements.waste),count);
    html+=costed?columns('Rotación mensual','Veces que se renueva el inventario en el mes',pts('rotation',x=>x.rotation||0),v=>times(v),v=>new Intl.NumberFormat('es-MX',{maximumFractionDigits:2}).format(v)):'';
    html+=`</div><h2 class="section-title">Detalle por mes</h2>`;
    html+=table(['Mes','Entradas','Salidas','Mermas','Transferencias','Ajustes','Dev. a proveedor',...(costed?['Valor de salidas','Valor de mermas','Valor al cierre','Rotación']:[])],m.monthly.slice().reverse().map(x=>[esc(monthName(x.month)),count(x.movements.entries),count(x.movements.exits),count(x.movements.waste),count(x.movements.transfers),count(x.movements.adjustments),count(x.movements.supplierReturns),...(costed?[money(x.exitValue),money(x.wasteValue),money(x.closingValue),times(x.rotation)]:[])]));
    html+=`<h2 class="section-title">Rotación por artículo</h2><p class="note">Rotación = unidades que salieron en el periodo ÷ existencia promedio. Cobertura = días que alcanza la existencia actual al ritmo de salida del periodo.</p>`;
    html+=table(['SKU / artículo','Existencia','Salidas','Existencia promedio','Rotación','Cobertura','Mermas',...(costed?['Valor en existencia']:[])],m.articles.map(a=>[`${esc(a.sku)}<br><strong>${esc(a.name)}</strong>`,`${number(a.stock)} ${esc(a.unit)}`,`${number(a.exits)} ${esc(a.unit)}`,`${number(Math.round(a.averageStock/100)*100)} ${esc(a.unit)}`,times(a.rotation),a.coverageDays==null?'Sin salidas':count(a.coverageDays)+' días',`${number(a.waste)} ${esc(a.unit)}`,...(costed?[a.valued?money(a.stockValue):'Sin costo']:[])]));
    return html;
  }
  async function refresh(){const version=++loadVersion;try{if(!offline.loaded){offline.queue=await idb.queue();offline.loaded=true;}if(offline.queue.length)await flush();const next=await api('/snapshot');if(version!==loadVersion)return;state=next;metricsData=null;metricsError='';await loadInboxSeen();render();notifyExpiry();announceInbox();}catch(e){if(state)toast(e.message);else $('main').innerHTML=`<section class="panel onboarding"><h1>No se pudo cargar el inventario</h1><p>${esc(e.message)}</p>${button('Reintentar','refresh')}</section>`;}}
  const field=(label,name,type='text',value='',extra='')=>`<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra} required></label>`;
  const select=(label,name,options)=>`<label class="field">${label}<select name="${name}" required>${options.map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('')}</select></label>`;
  const articles=()=>select('Artículo','articleId',state.articles.filter(a=>a.active).map(a=>[a.id,`${a.sku} · ${a.name} (${a.unit})`]));
  const warehouses=(label='Almacén de origen / recepción',name='warehouseId')=>select(label,name,state.warehouses.map(w=>[w.id,w.name]));
  const partners=kind=>select(kind==='Proveedor'?'Proveedor':'Destinatario','partnerId',state.partners.filter(p=>kind==='Proveedor'?p.kind===kind:p.kind!=='Proveedor').map(p=>[p.id,p.name]));
  const qty=()=>field('Cantidad','quantity','number','1','min="1" step="1"');
  function modal(title,body){$('modal').classList.toggle('wide',body.includes('<table'));$('modal-content').innerHTML=`<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-op="close" aria-label="Cerrar">×</button></div><div class="modal-body">${body}</div>`;if(state){attachScan($('modal-content'));setupPacks($('modal-content').querySelector('form'));}$('modal').showModal();}
  async function prepareLogo(file){
    if(file.size>5*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Elige un PNG, JPEG o WebP de hasta 5 MB.');
    const source=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('No se pudo leer la imagen.'));r.readAsDataURL(file);});
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('El archivo no es una imagen válida.'));i.src=source;});
    for(const size of [512,384,256,192,128]){
      const scale=Math.min(1,size/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const result=canvas.toDataURL('image/webp',.85);if(result.length<=45000)return result;
    }
    throw Error('No se pudo ajustar la imagen. Prueba con una versión más pequeña.');
  }
  function form(title,fields,path,method='POST',initial={}){
    initial={_operationId:crypto.randomUUID(),...initial};
    modal(title,`<form id="ops-form" class="auth-form">${fields}<p id="form-error" class="auth-message" role="alert" hidden></p><div class="modal-actions">${button('Cancelar','close')}<button class="button primary" type="submit">Guardar</button></div></form>`);
    let logoTask=Promise.resolve(initial.logo||'');
    const f=$('ops-form');
    if(path==='/company'){
      f.elements.namedItem('removeLogo').parentElement.hidden=!initial.logo;
      const box=document.createElement('div');box.className='logo-preview';
      box.innerHTML='<p>Vista previa · pulsa Guardar para aplicar</p><img alt="Vista previa del logo"><span role="status"></span>';
      f.elements.namedItem('logoFile').parentElement.after(box);
      const preview=box.querySelector('img'),status=box.querySelector('span');preview.hidden=!initial.logo;if(initial.logo)preview.src=initial.logo;
      f.elements.namedItem('logoFile').onchange=()=>{
        const file=f.elements.namedItem('logoFile').files[0];f.elements.namedItem('removeLogo').checked=false;
        status.textContent=file?'Preparando imagen…':'';
        const task=file?prepareLogo(file):Promise.resolve(initial.logo||'');logoTask=task;
        task.then(src=>{if(logoTask!==task)return;preview.hidden=!src;preview.src=src;status.textContent=src?'Imagen lista para guardar.':'';}).catch(error=>{if(logoTask!==task)return;preview.hidden=true;status.textContent=error.message;});
      };
      f.elements.namedItem('removeLogo').onchange=e=>{preview.hidden=e.target.checked||!preview.getAttribute('src');status.textContent=e.target.checked?'Se quitará el logo al guardar.':'Vista previa restaurada.';};
    }
    for(const [key,value] of Object.entries(initial))if(f.elements.namedItem(key))f.elements.namedItem(key).value=value;
    const precision=()=>{const a=article(f.elements.namedItem('articleId')?.value)||article(state.batches.find(b=>b.id===f.elements.namedItem('batchId')?.value)?.articleId);const q=f.elements.namedItem('quantity')||f.elements.namedItem('minimum')||f.elements.namedItem('countedQuantity');if(q&&a){q.step=a.unit==='pzas'?'1':'0.001';q.min=['minimum','countedQuantity'].includes(q.name)?'0':q.step;}};
    f.elements.namedItem('articleId')?.addEventListener('change',precision);f.elements.namedItem('batchId')?.addEventListener('change',precision);precision();
    f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('[type="submit"]');b.disabled=true;$('form-error').hidden=true;try{const data={...initial,...Object.fromEntries(new FormData(f))};if('active'in data)data.active=data.active==='true';if(path==='/company'){data.logo=initial.logo||'';const file=f.elements.namedItem('logoFile').files[0];if(file)data.logo=await logoTask;if(f.elements.namedItem('removeLogo').checked)data.logo='';delete data.logoFile;delete data.removeLogo;}await api(path,method,data);$('modal').close();await refresh();toast('Cambios guardados en el servidor.');}catch(error){$('form-error').textContent=error.message;$('form-error').hidden=false;}finally{b.disabled=false;}};
  }
  function receipt(purchase){
    const pending=purchase?purchaseItems(purchase).filter(item=>item.received<item.quantity):[],articleField=purchase?select('Artículo pendiente','articleId',pending.map(item=>[item.articleId,`${article(item.articleId)?.sku} · ${article(item.articleId)?.name} · pendiente ${number(item.quantity-item.received)} ${article(item.articleId)?.unit}`])):articles(),partnerField=purchase?`<input type="hidden" name="partnerId" value="${esc(purchase.partnerId)}"><p class="note">Proveedor: ${esc(partner(purchase.partnerId))}</p>`:partners('Proveedor');
    form('Recepción de mercancía',articleField+warehouses()+partnerField+field('Número de lote','lot')+qty()+`<label class="field">Caducidad (opcional)<input type="date" name="expiry" min="${day()}"></label>`+optional('Ubicación en el almacén (opcional)','location','text','maxlength="30" autocomplete="off" placeholder="Ej. A-03-2"')+`<label class="field">Costo unitario en MXN (opcional)<input type="number" name="unitCost" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label>`+field('Documento de recepción','reference'),'/receipts','POST',purchase?{purchaseId:purchase.id,reference:purchase.reference}:{});
    if(purchase){const f=$('ops-form'),articleSelect=f.elements.namedItem('articleId'),quantity=f.elements.namedItem('quantity'),sync=()=>{const item=pending.find(x=>x.articleId===articleSelect.value);if(item)quantity.value=(item.quantity-item.received)/1000;};articleSelect.addEventListener('change',sync);sync();}
  }
  function physicalCount(){
    const batches=state.batches.filter(b=>b.quantity>0||b.reserved>0);
    form('Conteo físico por lote',select('Lote y almacén','batchId',batches.map(b=>[b.id,`${article(b.articleId)?.name} · ${b.lot} · ${wh(b.warehouseId)} · registrado ${number(b.quantity)} ${article(b.articleId)?.unit}`]))+field('Cantidad física contada','countedQuantity','number','0','min="0" step="1"')+select('Motivo','reason',[['Conteo cíclico','Conteo cíclico'],['Inventario general','Inventario general'],['Corrección documental','Corrección documental']])+field('Referencia del conteo','reference')+'<p class="note">El ajuste se aplicará al lote seleccionado. La cantidad contada no puede ser menor que la mercancía ya reservada.</p>','/counts');
    const f=$('ops-form'),batchSelect=f.elements.namedItem('batchId'),counted=f.elements.namedItem('countedQuantity');
    const sync=()=>{const b=state.batches.find(x=>x.id===batchSelect.value);if(b)counted.value=b.quantity/1000;};batchSelect.addEventListener('change',sync);sync();
  }
  const normalized=v=>String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  function csvTable(text){
    text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');let commas=0,semicolons=0,quoted=false;
    for(const c of text){if(c==='"')quoted=!quoted;else if(!quoted&&c==='\n')break;else if(!quoted&&c===',')commas++;else if(!quoted&&c===';')semicolons++;}
    const delimiter=semicolons>commas?';':',',rows=[[]];let value='',inside=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(inside){if(c==='"'&&text[i+1]==='"'){value+='"';i++;}else if(c==='"')inside=false;else value+=c;}else if(c==='"'&&!value)inside=true;else if(c===delimiter){rows.at(-1).push(value);value='';}else if(c==='\n'){rows.at(-1).push(value);value='';rows.push([]);}else value+=c;}
    if(inside)throw Error('El CSV contiene comillas sin cerrar.');rows.at(-1).push(value);
    const clean=rows.filter(row=>row.some(cell=>cell.trim())),headers=(clean.shift()||[]).map(normalized);return{rows:clean,headers};
  }
  function parseCSV(text){
    const {rows:clean,headers}=csvTable(text),column=names=>headers.findIndex(h=>names.includes(h));
    const indexes={sku:column(['sku','codigo']),name:column(['nombre','name','articulo','producto']),kind:column(['tipo','kind']),unit:column(['unidad','unit'])};
    if(Object.values(indexes).some(i=>i<0))throw Error('El encabezado debe incluir SKU, Nombre, Tipo y Unidad.');
    if(!clean.length)throw Error('El archivo no contiene artículos.');if(clean.length>200)throw Error('Solo se permiten 200 artículos por archivo.');
    const kinds={insumo:'Insumo','producto terminado':'Producto terminado',mercancia:'Mercancía'},units={pzas:'pzas',pieza:'pzas',piezas:'pzas',kg:'kg',kilogramo:'kg',kilogramos:'kg',l:'L',litro:'L',litros:'L'};
    return clean.map((row,i)=>{const kind=kinds[normalized(row[indexes.kind])],unit=units[normalized(row[indexes.unit])];if(!kind||!unit)throw Error(`Tipo o unidad inválido en la fila ${i+2}.`);return{sku:String(row[indexes.sku]??'').trim(),name:String(row[indexes.name]??'').trim(),kind,unit};});
  }
  function parseInventoryCSV(text){
    const {rows,headers}=csvTable(text),column=names=>headers.findIndex(h=>names.includes(h)),indexes={sku:column(['sku','codigo']),warehouse:column(['almacen','bodega']),supplier:column(['proveedor']),lot:column(['lote']),quantity:column(['cantidad']),expiry:column(['caducidad','vencimiento']),reference:column(['referencia','documento'])},costColumn=column(['costo','costo unitario','costo_unitario']);
    if(Object.values(indexes).some(i=>i<0))throw Error('El encabezado debe incluir SKU, Almacén, Proveedor, Lote, Cantidad, Caducidad y Referencia.');if(!rows.length)throw Error('El archivo no contiene existencias.');if(rows.length>100)throw Error('Solo se permiten 100 existencias por archivo.');
    const unique=(values,label,row)=>{if(values.length!==1)throw Error(`${label} no encontrado o ambiguo en la fila ${row}.`);return values[0];};
    return rows.map((row,i)=>{const line=i+2,sku=String(row[indexes.sku]??'').trim().toUpperCase(),warehouseName=normalized(row[indexes.warehouse]),supplierName=normalized(row[indexes.supplier]),a=unique(state.articles.filter(x=>x.sku===sku),'SKU',line),w=unique(state.warehouses.filter(x=>normalized(x.name)===warehouseName),'Almacén',line),p=unique(state.partners.filter(x=>x.kind==='Proveedor'&&normalized(x.name)===supplierName),'Proveedor',line);return{articleId:a.id,warehouseId:w.id,partnerId:p.id,lot:String(row[indexes.lot]??'').trim(),quantity:String(row[indexes.quantity]??'').trim(),expiry:String(row[indexes.expiry]??'').trim(),reference:String(row[indexes.reference]??'').trim(),unitCost:costColumn<0?'':String(row[costColumn]??'').trim().replace(/^\$/,'').replace(/,/g,'')};});
  }
  function importArticles(){
    modal('Importar artículos desde CSV','<form id="import-form" class="auth-form"><label class="field">Archivo CSV<input type="file" name="file" accept=".csv,text/csv" required></label><p class="note">Columnas requeridas: SKU, Nombre, Tipo y Unidad. Tipos: Mercancía, Insumo o Producto terminado. Unidades: pzas, kg o L. Máximo 200 filas.</p><p id="import-error" class="auth-message" role="alert" hidden></p><div class="modal-actions">'+button('Cancelar','close')+'<button class="button primary" type="submit">Importar</button></div></form>');
    const f=$('import-form'),operationId=crypto.randomUUID();f.onsubmit=async e=>{e.preventDefault();const submit=f.querySelector('[type="submit"]'),error=$('import-error'),file=f.elements.namedItem('file').files[0];submit.disabled=true;error.hidden=true;try{if(file.size>1024*1024)throw Error('El archivo CSV no puede superar 1 MB.');const rows=parseCSV(await file.text()),result=await api('/articles/import','POST',{_operationId:operationId,rows});$('modal').close();await refresh();toast(`${result.count} artículos importados correctamente.`);}catch(ex){error.textContent=ex.message;error.hidden=false;}finally{submit.disabled=false;}};
  }
  function importInventory(){
    modal('Importar existencias iniciales','<form id="inventory-import-form" class="auth-form"><label class="field">Archivo CSV<input type="file" name="file" accept=".csv,text/csv" required></label><p class="note">Columnas: SKU, Almacén, Proveedor, Lote, Cantidad, Caducidad y Referencia; Costo (unitario, MXN) es opcional. Los nombres deben coincidir con el catálogo. Caducidad y Costo pueden quedar vacíos. Máximo 100 filas.</p><p id="inventory-import-error" class="auth-message" role="alert" hidden></p><div class="modal-actions">'+button('Cancelar','close')+'<button class="button primary" type="submit">Importar existencias</button></div></form>');
    const f=$('inventory-import-form'),operationId=crypto.randomUUID();f.onsubmit=async e=>{e.preventDefault();const submit=f.querySelector('[type="submit"]'),error=$('inventory-import-error'),file=f.elements.namedItem('file').files[0];submit.disabled=true;error.hidden=true;try{if(file.size>1024*1024)throw Error('El archivo CSV no puede superar 1 MB.');const rows=parseInventoryCSV(await file.text()),result=await api('/inventory/import','POST',{_operationId:operationId,rows});$('modal').close();await refresh();toast(`${result.count} existencias importadas correctamente.`);}catch(ex){error.textContent=ex.message;error.hidden=false;}finally{submit.disabled=false;}};
  }
  function requestForm(){
    modal('Solicitud al almacén',`<form id="request-form" class="auth-form">${warehouses()}<div id="request-lines"></div><button id="add-request-line" class="button" type="button">Agregar otro artículo</button>${field('Empresa / punto de venta destinatario','destination')}${field('Referencia de la solicitud','reference')}<p class="note">La solicitud no descuenta inventario. Almacén reservará todos los artículos al aprobar y podrá despacharlos en varias entregas.</p><p id="request-error" class="auth-message" role="alert" hidden></p><div class="modal-actions">${button('Cancelar','close')}<button class="button primary" type="submit">Guardar</button></div></form>`);
    const f=$('request-form'),lines=$('request-lines'),operationId=crypto.randomUUID();
    const addLine=()=>{const row=document.createElement('div');row.className='form-grid request-line';row.innerHTML=articles()+field('Cantidad','quantity','number','1','min="1" step="1"')+'<button class="button" type="button">Quitar artículo</button>';const selectBox=row.querySelector('[name="articleId"]'),quantity=row.querySelector('[name="quantity"]'),precision=()=>{const a=article(selectBox.value);quantity.step=a?.unit==='pzas'?'1':'0.001';};selectBox.addEventListener('change',precision);row.querySelector('button').onclick=()=>{if(lines.children.length>1)row.remove();};lines.append(row);precision();};
    addLine();$('add-request-line').onclick=()=>{if(lines.children.length<20)addLine();};
    f.onsubmit=async e=>{e.preventDefault();const submit=f.querySelector('[type="submit"]'),error=$('request-error'),items=[...lines.children].map(row=>({articleId:row.querySelector('[name="articleId"]').value,quantity:row.querySelector('[name="quantity"]').value}));submit.disabled=true;error.hidden=true;try{await api('/requests','POST',{_operationId:operationId,warehouseId:f.elements.namedItem('warehouseId').value,destination:f.elements.namedItem('destination').value,reference:f.elements.namedItem('reference').value,items});$('modal').close();await refresh();toast('Solicitud creada.');}catch(ex){error.textContent=ex.message;error.hidden=false;}finally{submit.disabled=false;}};
  }
  function purchaseForm(){
    modal('Compra a proveedor',`<form id="purchase-form" class="auth-form">${partners('Proveedor')}<div id="purchase-lines"></div><button id="add-purchase-line" class="button" type="button">Agregar otro artículo</button>${field('Referencia de compra','reference')}<p class="note">Cada artículo podrá recibirse por separado y en varias entregas.</p><p id="purchase-error" class="auth-message" role="alert" hidden></p><div class="modal-actions">${button('Cancelar','close')}<button class="button primary" type="submit">Guardar</button></div></form>`);
    const f=$('purchase-form'),lines=$('purchase-lines'),operationId=crypto.randomUUID();
    const addLine=()=>{const row=document.createElement('div');row.className='form-grid purchase-line';row.innerHTML=articles()+field('Cantidad','quantity','number','1','min="1" step="1"')+'<button class="button" type="button">Quitar artículo</button>';const selectBox=row.querySelector('[name="articleId"]'),quantity=row.querySelector('[name="quantity"]'),precision=()=>{const a=article(selectBox.value);quantity.step=a?.unit==='pzas'?'1':'0.001';};selectBox.addEventListener('change',precision);row.querySelector('button').onclick=()=>{if(lines.children.length>1)row.remove();};lines.append(row);precision();};
    addLine();$('add-purchase-line').onclick=()=>{if(lines.children.length<20)addLine();};
    f.onsubmit=async e=>{e.preventDefault();const submit=f.querySelector('[type="submit"]'),error=$('purchase-error'),items=[...lines.children].map(row=>({articleId:row.querySelector('[name="articleId"]').value,quantity:row.querySelector('[name="quantity"]').value}));submit.disabled=true;error.hidden=true;try{await api('/purchases','POST',{_operationId:operationId,partnerId:f.elements.namedItem('partnerId').value,reference:f.elements.namedItem('reference').value,items});$('modal').close();await refresh();toast('Compra creada.');}catch(ex){error.textContent=ex.message;error.hidden=false;}finally{submit.disabled=false;}};
  }
  function dispatchRequest(request){
    const pending=requestItems(request).map(item=>{const dispatched=item.allocations.reduce((n,a)=>n+(a.dispatched||0),0);return{...item,pending:item.quantity-dispatched};}).filter(item=>item.pending>0);
    modal('Despacho parcial · '+request.reference,`<form id="dispatch-form" class="auth-form"><p>Indica cuánto entregar ahora. Puedes dejar artículos en cero para una entrega posterior.</p>${pending.map(item=>{const a=article(item.articleId),step=a?.unit==='pzas'?'1':'0.001';return `<label class="field">${esc(a?.name)} · pendiente ${number(item.pending)} ${esc(a?.unit)}<input type="number" data-article-id="${esc(item.articleId)}" value="${number(item.pending).replaceAll(',','')}" min="0" max="${item.pending/1000}" step="${step}" required></label>`;}).join('')}<p id="dispatch-error" class="auth-message" role="alert" hidden></p><div class="modal-actions">${button('Cancelar','close')}<button class="button primary" type="submit">Registrar despacho</button></div></form>`);
    const f=$('dispatch-form'),operationId=crypto.randomUUID();f.onsubmit=async e=>{e.preventDefault();const submit=f.querySelector('[type="submit"]'),error=$('dispatch-error'),items=[...f.querySelectorAll('[data-article-id]')].map(input=>({articleId:input.dataset.articleId,quantity:input.value}));submit.disabled=true;error.hidden=true;try{await api('/requests/'+request.id,'PATCH',{action:'dispatch',_operationId:operationId,items});$('modal').close();await refresh();toast('Despacho registrado.');}catch(ex){error.textContent=ex.message;error.hidden=false;}finally{submit.disabled=false;}};
  }
  // =====================================================================
  // Funciones ampliadas: alertas de caducidad, kardex, sugerencias de
  // compra, documentos imprimibles, etiquetas con código de barras y
  // escaneo (lector USB/Bluetooth, cámara o teclado).
  // Todo se calcula con el snapshot, así que también funciona sin conexión.
  // =====================================================================
  const DAY_MS=86400000;
  const mxDay=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
  const shortDate=ymd=>ymd?new Date(ymd+'T12:00:00Z').toLocaleDateString('es-MX',{timeZone:'UTC'}):'—';
  const daysUntil=ymd=>Math.round((Date.parse(ymd+'T12:00:00Z')-Date.parse(day()+'T12:00:00Z'))/DAY_MS);
  const tag=(text,cls='')=>`<span class="pill ${cls}">${esc(text)}</span>`;
  const optional=(label,name,type='text',extra='')=>`<label class="field">${label}<input name="${name}" type="${type}" ${extra}></label>`;
  const supplierSelect=(label,name,selected='')=>`<label class="field">${label}<select name="${name}"><option value="">Sin proveedor preferido</option>${state.partners.filter(p=>p.kind==='Proveedor').map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`;
  const batchOf=id=>state.batches.find(b=>b.id===id);
  const pesosOf=(qty,unitCost)=>unitCost==null?null:qty*unitCost/1000/100;
  function downloadCSV(rows,filename){
    const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  // ---------- Alertas de caducidad ----------
  let expiryWindow=30;
  const lowStock=()=>state.policies.filter(p=>totals(p.articleId,p.warehouseId).available<p.minimum);
  const expiring=(within=expiryWindow)=>state.batches.filter(b=>b.quantity>0&&b.expiry).map(b=>({b,days:daysUntil(b.expiry)})).filter(x=>x.days<=within).sort((x,y)=>x.days-y.days);
  const urgency=d=>d<0?['Caducado','red']:d<=7?['Crítico','red']:d<=15?['Próximo','amber']:['Por caducar','gray'];
  const whenText=d=>d<0?`caducó hace ${-d} día${d===-1?'':'s'}`:d===0?'caduca hoy':`en ${d} día${d===1?'':'s'}`;
  function expiryAdvice(x){
    if(x.days<0)return 'Registra la merma o devuélvelo al proveedor.';
    if(x.b.reserved>=x.b.quantity)return 'Ya está reservado: despáchalo cuanto antes.';
    if(x.days<=7)return 'Usa este lote en la siguiente salida o negocia su devolución.';
    return 'PEPS lo tomará primero si es la recepción más antigua; revisa su rotación.';
  }
  function expiryRows(list){
    return list.map(x=>{
      const a=article(x.b.articleId),[label,cls]=urgency(x.days),value=pesosOf(x.b.quantity,x.b.unitCost);
      let actions='';
      if(allow('almacen')){
        if(x.b.quantity>x.b.reserved)actions+=button('Merma','waste-batch',x.b.id)+button('Devolver','return-batch',x.b.id);
      }
      actions+=button('Trazabilidad','trace',x.b.id);
      return[tag(label,cls),`${esc(a?.name)}<br>Lote ${esc(x.b.lot)}`,esc(wh(x.b.warehouseId)),`${esc(shortDate(x.b.expiry))}<br>${esc(whenText(x.days))}`,`${number(x.b.quantity)} ${esc(a?.unit)}${x.b.reserved?`<br>${number(x.b.reserved)} reservado`:''}`,value==null?'—':esc(money(value)),`${esc(expiryAdvice(x))}<div class="row-actions">${actions}</div>`];
    });
  }
  function alertsView(){
    const all=expiring(),expired=all.filter(x=>x.days<0).length,critical=all.filter(x=>x.days>=0&&x.days<=7).length,low=lowStock();
    const notifyButton='Notification'in window&&Notification.permission!=='granted'&&Notification.permission!=='denied'?button('Avisarme en este navegador','notify-expiry'):'';
    let html=`<div class="toolbar"><label class="field inline">Mostrar caducidades de los próximos<select id="expiry-window" class="filter">${[7,15,30,60,90].map(n=>`<option value="${n}" ${n===expiryWindow?'selected':''}>${n} días</option>`).join('')}</select></label>${button('Imprimir alertas','print-alerts')}${notifyButton}</div>`;
    html+=`<div class="metrics">${[['Lotes caducados',expired,'Retíralos del almacén'],['Caducan en 7 días o menos',critical,'Prioridad de salida'],[`Caducan en ${expiryWindow} días`,all.filter(x=>x.days>=0).length,'Incluye los críticos'],['Stock bajo',low.length,'Disponible menor al mínimo']].map(([l,n,note])=>`<div class="metric"><div class="metric-top">${esc(l)}</div><div class="metric-value">${n}</div><div class="metric-note">${esc(note)}</div></div>`).join('')}</div>`;
    html+=`<h2 class="section-title">Caducidades</h2>`+table(['Estado','Artículo / lote','Almacén','Caducidad','Existencia','Valor','Acción sugerida'],expiryRows(all));
    html+=`<h2 class="section-title">Stock bajo</h2>`+table(['Artículo','Almacén','Disponible','Mínimo','Faltante'],low.map(p=>{const a=article(p.articleId),t=totals(p.articleId,p.warehouseId);return[`${esc(a?.sku)} · ${esc(a?.name)}`,esc(wh(p.warehouseId)),`${number(t.available)} ${esc(a?.unit)}`,number(p.minimum),`${number(p.minimum-t.available)} ${esc(a?.unit)}`];}));
    return html+`<p class="note">Los avisos del navegador se muestran una vez al día cuando hay lotes caducados o que caducan en 7 días o menos. La caducidad se evalúa con el día de Ciudad de México.</p>`;
  }
  // One reminder per day, only if the user enabled browser notifications.
  // The marker lives in the offline store, which sign-out erases; this bundle keeps nothing in browser key-value storage.
  async function notifyExpiry(force=false){
    try{
      if(!('Notification'in window)||Notification.permission!=='granted'||!state||state.role==='solicitante')return;
      const key='expiry-notified:'+state.userId;if(!force&&await idb.get(key)===day())return;
      const urgent=expiring(7);if(!urgent.length)return;
      const expired=urgent.filter(x=>x.days<0).length,body=`${urgent.length} lote(s) requieren atención${expired?`, ${expired} ya caducado(s)`:''}. Abre Alertas para revisarlos.`;
      const options={body,icon:'/icons/icon-192.png',tag:'nexo-expiry'};
      (navigator.serviceWorker?.ready||Promise.reject()).then(r=>r.showNotification('Nexo · Caducidades',options)).catch(()=>new Notification('Nexo · Caducidades',options));
      await idb.set(key,day());
    }catch{}
  }

  // ---------- Kardex ----------
  const STOCK_SIGN={'Entrada':1,'Carga inicial':1,'Devolución de cliente':1,'Ajuste positivo':1,'Transferencia entrada':1,'Transferencia rechazada':1,'Salida PEPS':-1,'Despacho':-1,'Despacho parcial':-1,'Merma':-1,'Devolución a proveedor':-1,'Ajuste negativo':-1,'Transferencia salida':-1};
  const kardex={articleId:'',warehouseId:'',from:'',to:''};
  const counterpart=e=>e.destinationWarehouseId?'A '+wh(e.destinationWarehouseId):e.sourceWarehouseId?'De '+wh(e.sourceWarehouseId):e.destination||(e.partnerId?partner(e.partnerId):'');
  function kardexData(){
    const a=article(kardex.articleId);if(!a)return null;
    const events=state.events.filter(e=>e.articleId===a.id&&STOCK_SIGN[e.type]&&(!kardex.warehouseId||e.warehouseId===kardex.warehouseId)).sort((x,y)=>x.at.localeCompare(y.at)||x.id.localeCompare(y.id));
    const costed=state.batches.some(b=>b.articleId===a.id&&b.unitCost!=null);
    let balance=0,value=0,openingQty=0,openingValue=0,entries=0,exits=0;const rows=[];
    for(const e of events){
      const sign=STOCK_SIGN[e.type],b=batchOf(e.batchId),cost=b?.unitCost??null,amountValue=pesosOf(e.qty,cost)||0,d=mxDay(e.at);
      balance+=sign*e.qty;value+=sign*amountValue;
      if(kardex.from&&d<kardex.from){openingQty=balance;openingValue=value;continue;}
      if(kardex.to&&d>kardex.to)continue;
      if(sign>0)entries+=e.qty;else exits+=e.qty;
      rows.push({e,b,sign,cost,amountValue,balance,value});
    }
    const current=totals(a.id,kardex.warehouseId||undefined).physical;
    return{a,rows,costed,openingQty,openingValue,entries,exits,finalQty:rows.length?rows.at(-1).balance:openingQty,finalValue:rows.length?rows.at(-1).value:openingValue,consistent:kardex.to||balance===current,current};
  }
  function kardexTable(k){
    const headers=['Fecha','Movimiento','Documento / contraparte','Lote',...(kardex.warehouseId?[]:['Almacén']),'Entrada','Salida','Saldo',...(k.costed?['Costo unit.','Importe','Valor del saldo']:[])];
    const opening=[`<strong>${kardex.from?esc(shortDate(kardex.from)):'Inicio'}</strong>`,'<strong>Saldo inicial</strong>','','',...(kardex.warehouseId?[]:['']),'','',`<strong>${number(k.openingQty)}</strong>`,...(k.costed?['','',esc(money(k.openingValue))]:[])];
    const rows=k.rows.map(r=>[date(r.e.at),esc(r.e.type),`${esc(r.e.reference)}${counterpart(r.e)?`<br>${esc(counterpart(r.e))}`:''}`,esc(r.b?.lot||'—'),...(kardex.warehouseId?[]:[esc(wh(r.e.warehouseId))]),r.sign>0?number(r.e.qty):'',r.sign<0?number(r.e.qty):'',number(r.balance),...(k.costed?[r.cost==null?'—':esc(money(r.cost/100)),r.cost==null?'—':esc(money(r.amountValue)),esc(money(r.value))]:[])]);
    return {headers,rows:[opening,...rows]};
  }
  function kardexView(){
    if(!state.articles.length)return '<section class="panel onboarding"><h2>Sin artículos</h2><p>Crea artículos y registra movimientos para consultar su kardex.</p></section>';
    if(!article(kardex.articleId))kardex.articleId=state.articles[0].id;
    const k=kardexData(),t=kardexTable(k);
    let html=`<div class="toolbar kardex-toolbar"><label class="field inline">Artículo<select id="kardex-article" class="filter">${state.articles.map(a=>`<option value="${esc(a.id)}" ${a.id===kardex.articleId?'selected':''}>${esc(a.sku)} · ${esc(a.name)}</option>`).join('')}</select></label><label class="field inline">Almacén<select id="kardex-warehouse" class="filter"><option value="">Todos</option>${state.warehouses.map(w=>`<option value="${esc(w.id)}" ${w.id===kardex.warehouseId?'selected':''}>${esc(w.name)}</option>`).join('')}</select></label><label class="field inline">Desde<input id="kardex-from" class="filter" type="date" value="${esc(kardex.from)}"></label><label class="field inline">Hasta<input id="kardex-to" class="filter" type="date" value="${esc(kardex.to)}"></label>${button('Exportar CSV','export-kardex')}${button('Imprimir','print-kardex')}</div>`;
    html+=`<div class="metrics">${[['Saldo inicial',`${number(k.openingQty)} ${esc(k.a.unit)}`],['Entradas',`${number(k.entries)} ${esc(k.a.unit)}`],['Salidas',`${number(k.exits)} ${esc(k.a.unit)}`],['Saldo final',`${number(k.finalQty)} ${esc(k.a.unit)}`+(k.costed?`<small>${esc(money(k.finalValue))}</small>`:'')]].map(([l,v])=>`<div class="metric"><div class="metric-top">${l}</div><div class="metric-value">${v}</div></div>`).join('')}</div>`;
    html+=table(t.headers,t.rows);
    if(!k.consistent)html+=`<p class="note">El saldo del kardex (${number(k.finalQty)}) no coincide con la existencia física actual (${number(k.current)}). Puede deberse a lotes creados antes de que existiera el registro de movimientos.</p>`;
    return html+`<p class="note">Kardex en ${esc(k.a.unit)}: incluye entradas, salidas, mermas, devoluciones, ajustes de conteo y transferencias. ${k.costed?'Los importes usan el costo unitario de cada lote (capas PEPS).':'Registra el costo unitario al recibir mercancía para ver importes.'}</p>`;
  }
  function exportKardex(){
    const k=kardexData();if(!k)return;
    const rows=[['Fecha','Movimiento','Documento','Contraparte','Lote','Almacén','Entrada','Salida','Saldo','Costo unitario','Importe','Valor del saldo'],['','Saldo inicial','','','','','','',k.openingQty/1000,'','',k.costed?k.openingValue.toFixed(2):'']];
    for(const r of k.rows)rows.push([date(r.e.at),r.e.type,r.e.reference||'',counterpart(r.e),r.b?.lot||'',wh(r.e.warehouseId),r.sign>0?r.e.qty/1000:'',r.sign<0?r.e.qty/1000:'',r.balance/1000,r.cost==null?'':(r.cost/100).toFixed(2),r.cost==null?'':r.amountValue.toFixed(2),k.costed?r.value.toFixed(2):'']);
    downloadCSV(rows,`kardex-${k.a.sku}-${day()}.csv`);
  }

  // ---------- Sugerencias de compra ----------
  const replenish={safety:7,cover:30,all:false};
  const lastSupplier=articleId=>state.batches.filter(b=>b.articleId===articleId&&b.partnerId&&state.partners.find(p=>p.id===b.partnerId)?.kind==='Proveedor').sort((x,y)=>y.receivedAt.localeCompare(x.receivedAt))[0]?.partnerId||'';
  const lastCost=articleId=>state.batches.filter(b=>b.articleId===articleId&&b.unitCost!=null).sort((x,y)=>y.receivedAt.localeCompare(x.receivedAt))[0]?.unitCost??null;
  function replenishRows(){
    const since=Date.now()-90*DAY_MS,open=state.purchases.filter(p=>!['Recibida','Cancelada'].includes(p.status));
    return state.articles.filter(a=>a.active).map(a=>{
      const t=totals(a.id),onOrder=open.flatMap(purchaseItems).filter(i=>i.articleId===a.id).reduce((n,i)=>n+i.quantity-i.received,0);
      const out=state.events.filter(e=>e.articleId===a.id&&['Salida PEPS','Despacho','Despacho parcial'].includes(e.type)&&Date.parse(e.at)>=since).reduce((n,e)=>n+e.qty,0);
      const daily=out/90,lead=a.leadTimeDays??7,minimum=state.policies.filter(p=>p.articleId===a.id).reduce((n,p)=>n+p.minimum,0);
      const reorder=Math.max(minimum,Math.ceil(daily*(lead+replenish.safety))),position=t.available+onOrder,target=Math.max(minimum,Math.ceil(daily*(lead+replenish.safety+replenish.cover)));
      let suggested=position<reorder||(t.available<=0&&minimum>0&&position<minimum)?Math.max(0,target-position):0;
      if(a.unit==='pzas')suggested=Math.ceil(suggested/1000)*1000;
      if(suggested&&a.packSize)suggested=Math.ceil(suggested/a.packSize)*a.packSize;
      const status=!suggested?['Suficiente','']:t.available<=0?['Agotado','red']:['Comprar','amber'];
      return{a,t,onOrder,daily,lead,minimum,reorder,suggested,status,coverage:daily>0?Math.floor(t.available/daily):null,supplier:a.preferredPartnerId||lastSupplier(a.id),cost:lastCost(a.id)};
    }).sort((x,y)=>(y.suggested>0)-(x.suggested>0)||(x.coverage??1e9)-(y.coverage??1e9));
  }
  function replenishView(){
    const rows=replenishRows(),shown=replenish.all?rows:rows.filter(r=>r.suggested>0),suppliers=state.partners.filter(p=>p.kind==='Proveedor');
    let html=`<div class="toolbar"><label class="field inline">Stock de seguridad (días)<input id="replenish-safety" class="filter" type="number" min="0" max="120" value="${replenish.safety}"></label><label class="field inline">Cubrir (días)<input id="replenish-cover" class="filter" type="number" min="1" max="365" value="${replenish.cover}"></label><label class="check-inline"><input id="replenish-all" type="checkbox" ${replenish.all?'checked':''}> Mostrar todos los artículos</label>${allow('compras')?button('Crear órdenes de compra','create-suggested','',true):''}</div>`;
    const body=shown.map(r=>{
      const unit=esc(r.a.unit),step=r.a.unit==='pzas'?'1':'0.001',estimate=r.cost==null?null:r.suggested/1000*r.cost/100;
      return[`<input type="checkbox" class="suggest-check" data-article="${esc(r.a.id)}" aria-label="Incluir ${esc(r.a.name)}" ${r.suggested>0?'checked':''}>`,`${esc(r.a.sku)}<br><strong>${esc(r.a.name)}</strong>`,`${number(r.t.available)} ${unit}`,r.onOrder?`${number(r.onOrder)} ${unit}`:'—',r.daily?`${number(Math.round(r.daily))} ${unit}/día`:'Sin salidas',r.coverage==null?'—':`${r.coverage} días`,`${number(r.reorder)} ${unit}`,`<input type="number" class="suggest-qty filter" data-article="${esc(r.a.id)}" min="0" step="${step}" value="${r.suggested/1000}" aria-label="Cantidad a comprar de ${esc(r.a.name)}"> ${tag(...r.status)}${r.a.packSize&&r.suggested?`<br><small>${esc(inPacks(r.suggested,r.a).slice(3))}</small>`:''}`,`<select class="suggest-supplier filter" data-article="${esc(r.a.id)}" aria-label="Proveedor para ${esc(r.a.name)}"><option value="">Elegir proveedor</option>${suppliers.map(p=>`<option value="${esc(p.id)}" ${p.id===r.supplier?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`,r.cost==null?'—':esc(money(r.cost/100)),estimate==null?'—':esc(money(estimate))];
    });
    html+=table(['<span class="sr-only">Incluir</span>','Artículo','Disponible','En camino','Consumo (90 días)','Cobertura','Punto de reorden','Sugerido','Proveedor','Último costo','Importe estimado'],body);
    const total=shown.reduce((n,r)=>n+(r.cost==null?0:r.suggested/1000*r.cost/100),0);
    return html+`<p class="note">Punto de reorden = consumo diario × (tiempo de entrega + stock de seguridad), y nunca menos que la suma de mínimos por almacén. Si el disponible más lo que viene en camino es menor, se sugiere comprar hasta cubrir ${replenish.cover} días adicionales. El tiempo de entrega y el proveedor preferido se configuran en cada artículo (7 días si no se indica).${total?` Importe estimado de lo sugerido: ${esc(money(total))}.`:''}</p>`;
  }
  async function createSuggested(trigger){
    const chosen=[...document.querySelectorAll('.suggest-check:checked')].map(c=>{const id=c.dataset.article;return{a:article(id),qty:document.querySelector(`.suggest-qty[data-article="${CSS.escape(id)}"]`).value,supplier:document.querySelector(`.suggest-supplier[data-article="${CSS.escape(id)}"]`).value};}).filter(x=>Number(x.qty)>0);
    if(!chosen.length)throw Error('Marca al menos un artículo con cantidad mayor a cero.');
    const missing=chosen.filter(x=>!x.supplier);if(missing.length)throw Error('Elige el proveedor de: '+missing.map(x=>x.a.name).join(', ')+'.');
    const groups=new Map();for(const x of chosen){if(!groups.has(x.supplier))groups.set(x.supplier,[]);groups.get(x.supplier).push(x);}
    trigger.disabled=true;let created=0,n=0;const stamp=day().replaceAll('-','');
    trigger.dataset.batch||=crypto.randomUUID().slice(0,8);
    for(const [supplier,items] of groups)for(let i=0;i<items.length;i+=20){
      n++;await api('/purchases','POST',{_operationId:`${trigger.dataset.batch}-sugerencia-${n}-${supplier}`.slice(0,80),partnerId:supplier,reference:`SUG-${stamp}-${n}`,items:items.slice(i,i+20).map(x=>({articleId:x.a.id,quantity:x.qty}))});created++;
    }
    await refresh();toast(`${created} orden(es) de compra creada(s) con las sugerencias.`);location.hash='#purchases';
  }

  // ---------- Documentos imprimibles ----------
  function printDoc(title,folio,meta,body,{signatures=['Entregó','Recibió','Autorizó']}={}){
    let area=$('print-area');if(!area){area=document.createElement('div');area.id='print-area';document.body.append(area);}
    const c=state.company,who=window.nexoAuth?.user()?.name||'';
    area.innerHTML=`<article class="doc"><header class="doc-head">${c.logo?`<img src="${esc(c.logo)}" alt="">`:''}<div class="doc-company"><strong>${esc(c.name)}</strong><span>Control de inventario · Nexo</span></div><div class="doc-title"><h1>${esc(title)}</h1>${folio?`<p>${esc(folio)}</p>`:''}</div></header>${meta.length?`<dl class="doc-meta">${meta.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`:''}${body}${signatures.length?`<footer class="doc-sign">${signatures.map(s=>`<div>${esc(s)}</div>`).join('')}</footer>`:''}<p class="doc-foot">Impreso el ${esc(new Date().toLocaleString('es-MX'))}${who?' por '+esc(who):''}</p></article>`;
    document.body.classList.add('printing');
    const done=()=>{document.body.classList.remove('printing');removeEventListener('afterprint',done);};
    addEventListener('afterprint',done);setTimeout(()=>window.print(),50);
  }
  const docTable=(headers,rows,foot='')=>`<table class="doc-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">Sin registros.</td></tr>`}</tbody>${foot}</table>`;
  function printPurchase(p){
    const items=purchaseItems(p);let total=0;
    const rows=items.map(i=>{const a=article(i.articleId),cost=lastCost(i.articleId),amount=cost==null?null:i.quantity/1000*cost/100;if(amount)total+=amount;return[esc(a?.sku),esc(a?.name),esc(a?.unit),number(i.quantity)+esc(inPacks(i.quantity,a)),number(i.received),number(i.quantity-i.received),cost==null?'—':esc(money(cost/100)),amount==null?'—':esc(money(amount))];});
    printDoc('Orden de compra',p.reference,[['Proveedor',esc(partner(p.partnerId))],['Dirección / referencia',esc(state.partners.find(x=>x.id===p.partnerId)?.reference||'—')],['Fecha',esc(date(p.createdAt))],['Estado',esc(p.status)]],docTable(['SKU','Artículo','Unidad','Pedido','Recibido','Pendiente','Costo de referencia','Importe estimado'],rows,total?`<tfoot><tr><td colspan="7">Total estimado (último costo registrado)</td><td>${esc(money(total))}</td></tr></tfoot>`:''),{signatures:['Elaboró','Autorizó','Proveedor']});
  }
  function printRemission(r){
    const rows=state.events.filter(e=>e.requestId===r.id&&['Despacho parcial','Despacho'].includes(e.type)).sort((x,y)=>x.at.localeCompare(y.at)).map(e=>{const a=article(e.articleId),b=batchOf(e.batchId);return[esc(date(e.at)),esc(a?.sku),esc(a?.name),esc(b?.lot||'—'),esc(b?.expiry?shortDate(b.expiry):'—'),`${number(e.qty)} ${esc(a?.unit)}`];});
    printDoc('Remisión / vale de salida',r.reference,[['Destino',esc(r.destination)],['Almacén',esc(wh(r.warehouseId))],['Solicitó',esc(r.createdByName)],['Fecha de solicitud',esc(date(r.createdAt))],['Estado',esc(r.status)]],docTable(['Fecha de despacho','SKU','Artículo','Lote','Caducidad','Cantidad'],rows));
  }
  function printEvent(e){
    const a=article(e.articleId),b=batchOf(e.batchId),title=e.type==='Entrada'?'Comprobante de recepción':e.type==='Merma'?'Acta de merma':'Comprobante · '+e.type;
    const meta=[['Fecha',esc(date(e.at))],['Responsable',esc(e.actorName)],['Almacén',esc(wh(e.warehouseId))]];
    if(counterpart(e))meta.push(['Origen / destino',esc(counterpart(e))]);if(e.reason)meta.push(['Motivo',esc(e.reason)]);
    if(e.previousQuantity!=null)meta.push(['Conteo',`${number(e.previousQuantity)} registrado → ${number(e.countedQuantity)} contado`]);
    const cost=b?.unitCost??null;
    printDoc(title,e.reference,meta,docTable(['SKU','Artículo','Lote','Caducidad','Cantidad','Costo unitario','Importe'],[[esc(a?.sku),esc(a?.name),esc(b?.lot||'—'),esc(b?.expiry?shortDate(b.expiry):'—'),`${number(e.qty)} ${esc(a?.unit)}`,cost==null?'—':esc(money(cost/100)),cost==null?'—':esc(money(pesosOf(e.qty,cost)))]]));
  }
  function countSheetDialog(){
    modal('Hoja de conteo',`<form id="count-sheet-form" class="auth-form">${warehouses('Almacén')}<label class="check-inline"><input type="checkbox" name="blind" checked> Conteo a ciegas (no imprimir la cantidad del sistema)</label><p class="note">Imprime la lista de lotes con existencia para anotar lo contado. Después registra cada diferencia con <strong>Conteo físico</strong>.</p><div class="modal-actions">${button('Cancelar','close')}<button class="button primary" type="submit">Imprimir hoja</button></div></form>`);
    $('count-sheet-form').onsubmit=e=>{e.preventDefault();const f=e.target,w=f.elements.namedItem('warehouseId').value,blind=f.elements.namedItem('blind').checked;$('modal').close();
      const lots=state.batches.filter(b=>b.warehouseId===w&&(b.quantity>0||b.reserved>0)).sort((x,y)=>byLocation(x,y)||(article(x.articleId)?.name||'').localeCompare(article(y.articleId)?.name||'')||x.lot.localeCompare(y.lot));
      printDoc('Hoja de conteo físico',wh(w),[['Almacén',esc(wh(w))],['Fecha','____ / ____ / ________'],['Tipo',blind?'A ciegas':'Con cantidad del sistema']],docTable(['Ubicación','SKU','Artículo','Lote','Caducidad','Unidad',...(blind?[]:['Sistema']),'Contado','Observaciones'],lots.map(b=>{const a=article(b.articleId);return[esc(b.location||'—'),esc(a?.sku),esc(a?.name),esc(b.lot),esc(b.expiry?shortDate(b.expiry):'—'),esc(a?.unit),...(blind?[]:[number(b.quantity)]),'<span class="blank"></span>','<span class="blank wide"></span>'];})),{signatures:['Contó','Verificó','Autorizó']});};
  }
  function printKardex(){
    const k=kardexData();if(!k)return;const t=kardexTable(k);
    printDoc('Kardex',`${k.a.sku} · ${k.a.name}`,[['Artículo',`${esc(k.a.sku)} · ${esc(k.a.name)}`],['Almacén',esc(kardex.warehouseId?wh(kardex.warehouseId):'Todos')],['Periodo',`${esc(kardex.from?shortDate(kardex.from):'Inicio')} – ${esc(kardex.to?shortDate(kardex.to):'Hoy')}`],['Saldo final',`${number(k.finalQty)} ${esc(k.a.unit)}${k.costed?' · '+esc(money(k.finalValue)):''}`]],docTable(t.headers,t.rows),{signatures:[]});
  }
  function printAlerts(){
    const list=expiring();
    printDoc('Reporte de caducidades',`Próximos ${expiryWindow} días`,[['Fecha',esc(shortDate(day()))],['Lotes en la lista',String(list.length)]],docTable(['Estado','Artículo / lote','Almacén','Caducidad','Existencia','Valor','Acción sugerida'],expiryRows(list).map(r=>[...r.slice(0,6),r[6].replace(/<div class="row-actions">[\s\S]*<\/div>$/,'')])),{signatures:[]});
  }

  // ---------- Código de barras Code 128 (lectores USB y cámara) ----------
  const CODE128=('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112').split(' ');
  const encodable=v=>/^[\x20-\x7e]{1,40}$/.test(v);
  function barcodeSVG(value,height=48){
    if(!encodable(value))return '';
    const codes=[104,...[...value].map(c=>c.charCodeAt(0)-32)];
    codes.push(codes.reduce((sum,c,i)=>sum+c*(i||1),0)%103,106);
    let x=10,bars='';
    for(const code of codes){[...CODE128[code]].forEach((w,i)=>{w=Number(w);if(i%2===0)bars+=`M${x} 0h${w}v${height}h-${w}z`;x+=w;});}
    return `<svg class="barcode" viewBox="0 0 ${x+10} ${height}" preserveAspectRatio="none" role="img" aria-label="Código ${esc(value)}"><rect width="${x+10}" height="${height}" fill="#fff"/><path d="${bars}" fill="#000"/></svg>`;
  }
  const batchCode=b=>'L'+b.id.replace(/-/g,'').slice(0,10).toUpperCase();
  const articleCode=a=>a.barcode||a.sku;
  function labelDialog(kind,id){
    const item=kind==='batch'?batchOf(id):article(id);if(!item)return;
    const a=kind==='batch'?article(item.articleId):item,code=kind==='batch'?batchCode(item):articleCode(item);
    if(!encodable(code))return toast('El código contiene caracteres que no se pueden imprimir como código de barras (usa letras sin acento, números o guiones).');
    modal('Imprimir etiquetas',`<form id="label-form" class="auth-form"><div class="label-preview">${labelHTML(kind,item,a,code)}</div><label class="field">Número de etiquetas<input name="copies" type="number" min="1" max="120" value="${kind==='batch'?Math.min(120,Math.max(1,Math.ceil(item.quantity/1000))):1}" required></label><p class="note">${kind==='batch'?'La etiqueta identifica este lote exacto: al escanearla Nexo abre su trazabilidad y lo selecciona en mermas, conteos y devoluciones.':'La etiqueta usa el código de barras del artículo o, si no tiene, su SKU.'} Se imprimen en hojas carta, 3 por fila.</p><div class="modal-actions">${button('Cancelar','close')}<button class="button primary" type="submit">Imprimir</button></div></form>`);
    $('label-form').onsubmit=e=>{e.preventDefault();const copies=Math.min(120,Math.max(1,Number(e.target.elements.namedItem('copies').value)||1));$('modal').close();
      let area=$('print-area');if(!area){area=document.createElement('div');area.id='print-area';document.body.append(area);}
      area.innerHTML=`<div class="label-sheet">${Array.from({length:copies},()=>labelHTML(kind,item,a,code)).join('')}</div>`;
      document.body.classList.add('printing');const done=()=>{document.body.classList.remove('printing');removeEventListener('afterprint',done);};addEventListener('afterprint',done);setTimeout(()=>window.print(),50);};
  }
  function labelHTML(kind,item,a,code){
    const lines=kind==='batch'?[`Lote ${item.lot}`,item.expiry?`Cad. ${shortDate(item.expiry)}`:'Sin caducidad',wh(item.warehouseId)]:[`SKU ${a.sku}`,a.unit];
    return `<div class="label"><strong>${esc(a?.name)}</strong><span>${lines.map(esc).join(' · ')}</span>${barcodeSVG(code)}<code>${esc(code)}</code></div>`;
  }

  // ---------- Escaneo ----------
  function resolveCode(raw){
    const code=String(raw||'').trim().toUpperCase();if(!code)return null;
    const lot=/^L([0-9A-F]{10})$/.exec(code);
    if(lot){const b=state.batches.find(b=>b.id.replace(/-/g,'').toUpperCase().startsWith(lot[1]));if(b)return{type:'batch',batch:b};}
    const a=state.articles.find(a=>a.barcode===code||a.sku===code);if(a)return{type:'article',article:a};
    const lots=state.batches.filter(b=>b.lot.toUpperCase()===code&&(b.quantity>0||b.reserved>0));
    if(lots.length===1)return{type:'batch',batch:lots[0]};
    if(lots.length>1)return{type:'lots',batches:lots};
    return null;
  }
  const cameraFormats=['code_128','ean_13','ean_8','upc_a','upc_e','code_39','qr_code'];
  const cameraSupported=()=>'BarcodeDetector'in window&&!!navigator.mediaDevices?.getUserMedia;
  async function scanWithCamera(onCode){
    if(!cameraSupported())return toast('Este navegador no puede leer códigos con la cámara. Usa Chrome en Android o un lector USB/Bluetooth.');
    let dialog=$('camera-dialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='camera-dialog';dialog.className='camera-dialog';dialog.setAttribute('aria-label','Escanear con cámara');dialog.innerHTML='<video playsinline muted></video><div class="camera-frame" aria-hidden="true"></div><p role="status">Apunta al código de barras</p><button type="button" class="button">Cerrar cámara</button>';document.body.append(dialog);}
    const video=dialog.querySelector('video'),status=dialog.querySelector('p');let stream,stopped=false;
    const stop=()=>{stopped=true;stream?.getTracks().forEach(t=>t.stop());if(dialog.open)dialog.close();};
    dialog.querySelector('button').onclick=stop;dialog.onclose=()=>{stopped=true;stream?.getTracks().forEach(t=>t.stop());};
    try{
      const supported=await BarcodeDetector.getSupportedFormats?.()||cameraFormats,detector=new BarcodeDetector({formats:cameraFormats.filter(f=>supported.includes(f))});
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
      video.srcObject=stream;dialog.showModal();await video.play();
      while(!stopped){
        const found=await detector.detect(video).catch(()=>[]);
        if(found.length){stop();navigator.vibrate?.(80);onCode(found[0].rawValue);return;}
        await new Promise(r=>setTimeout(r,250));
      }
    }catch(e){stop();status.textContent='';toast(e.name==='NotAllowedError'?'Permite el acceso a la cámara para escanear.':'No se pudo abrir la cámara.');}
  }
  // Adds a scan field to any form that picks an article or a lot.
  function attachScan(root){
    // Multi-line forms (requests, purchases) add their article lines after opening, so detect them by their "add line" button.
    const formEl=root.querySelector('form'),picksArticle=!!formEl?.querySelector('select[name="articleId"],#add-request-line,#add-purchase-line');
    if(!formEl||!picksArticle&&!formEl.querySelector('select[name="batchId"]')||state.role==='solicitante'&&!picksArticle)return;
    const bar=document.createElement('div');bar.className='scan-bar';
    bar.innerHTML=`<label class="field">Escanear código<input type="text" inputmode="text" autocomplete="off" placeholder="Lector, SKU, código o lote y Enter"></label>${cameraSupported()?'<button type="button" class="button">Usar cámara</button>':''}<span class="scan-status" role="status"></span>`;
    formEl.prepend(bar);
    const input=bar.querySelector('input'),status=bar.querySelector('.scan-status');
    const apply=raw=>{
      const r=resolveCode(raw),set=(select,value)=>{if(![...select.options].some(o=>o.value===value))return false;select.value=value;select.dataset.scanned='1';select.dispatchEvent(new Event('change',{bubbles:true}));return true;};
      let ok=false,message='Código no encontrado.';
      const batchSelect=formEl.querySelector('select[name="batchId"]');
      if(r?.type==='batch'&&batchSelect){ok=set(batchSelect,r.batch.id);message=ok?`Lote ${r.batch.lot} seleccionado.`:'Ese lote no está disponible para esta operación.';}
      else if(r&&formEl.querySelector('select[name="articleId"]')){
        const a=r.type==='article'?r.article:article((r.batch||r.batches[0]).articleId);
        let target=[...formEl.querySelectorAll('select[name="articleId"]')].find(s=>!s.dataset.scanned);
        const addLine=formEl.querySelector('#add-request-line,#add-purchase-line');
        if(!target&&addLine){addLine.click();target=[...formEl.querySelectorAll('select[name="articleId"]')].at(-1);}
        if(target){ok=set(target,a.id);message=ok?`${a.name} seleccionado.`:'Ese artículo no está disponible en esta lista.';}
      }else if(r?.type==='lots')message='Hay varios lotes con ese número; escanea la etiqueta del lote.';
      status.textContent=message;status.classList.toggle('error',!ok);input.value='';if(ok)navigator.vibrate?.(40);
    };
    input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();apply(input.value);}});
    bar.querySelector('button')?.addEventListener('click',()=>scanWithCamera(apply));
  }
  function scanModal(){
    modal('Escanear código',`<form id="scan-form" class="auth-form"><div class="scan-bar"><label class="field">Código<input name="code" type="text" autocomplete="off" placeholder="Escanea con el lector o escribe SKU, código o lote" autofocus></label>${cameraSupported()?button('Usar cámara','scan-camera'):''}</div><div id="scan-result" aria-live="polite"><p class="note">Funciona con lectores USB o Bluetooth (actúan como teclado), con la cámara del celular en Chrome para Android o escribiendo el código.</p></div></form>`);
    const f=$('scan-form'),input=f.elements.namedItem('code');input.focus();
    const show=raw=>{const r=resolveCode(raw);$('scan-result').innerHTML=scanResult(r,raw);input.value='';input.focus();};
    f.onsubmit=e=>{e.preventDefault();show(input.value);};
    f.querySelector('[data-op="scan-camera"]')?.addEventListener('click',e=>{e.stopPropagation();scanWithCamera(show);});
  }
  function scanResult(r,raw){
    if(!r)return `<p class="auth-message">No se encontró «${esc(raw)}». Revisa que el artículo tenga ese SKU o código de barras.</p>`;
    if(r.type==='lots')return `<p>Hay ${r.batches.length} lotes con ese número:</p>`+table(['Artículo','Almacén','Existencia',''],r.batches.map(b=>[esc(article(b.articleId)?.name),esc(wh(b.warehouseId)),`${number(b.quantity)} ${esc(article(b.articleId)?.unit)}`,button('Ver lote','trace',b.id)]));
    if(r.type==='batch'){const b=r.batch,a=article(b.articleId),d=b.expiry?daysUntil(b.expiry):null;return `<section class="scan-card"><h3>${esc(a?.name)} · Lote ${esc(b.lot)}</h3><p>${esc(wh(b.warehouseId))}${b.location?` · Ubicación ${esc(b.location)}`:''} · ${number(b.quantity)} ${esc(a?.unit)}${b.reserved?` (${number(b.reserved)} reservado)`:''} · ${b.expiry?`Caduca ${esc(shortDate(b.expiry))} ${d>expiryWindow?tag('Vigente'):tag(...urgency(d))}`:'Sin caducidad'}</p><div class="row-actions">${button('Trazabilidad','trace',b.id)}${button('Etiqueta','label-batch',b.id)}${allow('almacen')&&b.quantity>b.reserved?button('Merma','waste-batch',b.id)+button('Devolver','return-batch',b.id):''}</div></section>`;}
    const a=r.article,rows=state.warehouses.map(w=>({w,...totals(a.id,w.id)})).filter(x=>x.physical||x.reserved);
    return `<section class="scan-card"><h3>${esc(a.name)}</h3><p>SKU ${esc(a.sku)}${a.barcode?` · Código ${esc(a.barcode)}`:''} · ${esc(a.unit)} · ${a.active?'Activo':'Desactivado'}</p>${table(['Almacén','Físico','Reservado','Disponible'],rows.map(x=>[esc(x.w.name),number(x.physical),number(x.reserved),number(x.available)]))}<div class="row-actions">${state.role!=='solicitante'?button('Ver kardex','open-kardex',a.id):''}${button('Etiqueta','label-article',a.id)}</div></section>`;
  }
  function wasteForm(initial={}){form('Registrar merma',select('Lote y almacén','batchId',state.batches.filter(b=>b.quantity>b.reserved).map(b=>[b.id,`${article(b.articleId)?.name} · ${b.lot} · ${wh(b.warehouseId)}`]))+qty()+select('Causa','reason',[['Daño','Daño'],['Caducidad','Caducidad'],['Derrame','Derrame'],['Pérdida en almacenamiento','Pérdida en almacenamiento']]),'/waste','POST',initial);}
  function supplierReturnForm(initial={}){form('Devolver mercancía a proveedor',select('Artículo, lote y almacén','batchId',state.batches.filter(b=>b.quantity>b.reserved).map(b=>[b.id,`${article(b.articleId)?.name} · ${b.lot} · ${wh(b.warehouseId)} · disponible ${number(b.quantity-b.reserved)}`]))+partners('Proveedor')+qty()+select('Motivo','reason',[['Producto dañado','Producto dañado'],['Producto incorrecto','Producto incorrecto'],['Caducidad próxima','Caducidad próxima'],['Otro','Otro']])+field('Referencia de devolución','reference')+'<p class="note">Se descontará únicamente mercancía no reservada del lote seleccionado.</p>','/returns/supplier','POST',initial);}
  function articleForm(a){
    const supply=supplierSelect('Proveedor preferido (opcional)','preferredPartnerId',a?.preferredPartnerId||'')+optional('Código de barras (opcional)','barcode','text','maxlength="40" autocomplete="off" placeholder="EAN/UPC del fabricante o código propio"')+optional('Tiempo de entrega del proveedor en días (opcional)','leadTimeDays','number','min="0" max="365" step="1" placeholder="7"')+`<div class="form-grid">${optional('Empaque de compra (opcional)','packName','text','maxlength="20" placeholder="Ej. Caja"')}${optional('Unidades base por empaque','packSize','number','min="0" step="0.001" placeholder="Ej. 12"')}</div>`;
    if(!a)return form('Nuevo artículo',field('SKU','sku')+field('Nombre','name')+select('Tipo','kind',[['Mercancía','Mercancía'],['Insumo','Insumo'],['Producto terminado','Producto terminado']])+select('Unidad base','unit',[['pzas','Piezas · enteros'],['kg','Kilogramos · hasta 3 decimales'],['L','Litros · hasta 3 decimales']])+supply+'<p class="note">El SKU ya se puede escanear. Agrega el código de barras si el producto trae uno distinto.</p>','/articles');
    form('Editar artículo',field('Nombre','name','text',a.name)+select('Estado','active',[['true','Activo'],['false','Desactivado']])+supply,'/articles/'+a.id,'PATCH',{active:String(a.active),barcode:a.barcode||'',preferredPartnerId:a.preferredPartnerId||'',leadTimeDays:a.leadTimeDays??'',packName:a.packName||'',packSize:a.packSize?a.packSize/1000:''});
  }

  // =====================================================================
  // Prioridad media: conteos cíclicos con aprobación, ubicaciones y lista
  // de surtido, unidades de empaque, avisos de solicitudes y bitácora.
  // =====================================================================

  // ---------- Unidades de empaque ----------
  const packLabel=a=>a?.packName&&a.packSize?`${a.packName} de ${number(a.packSize)} ${a.unit}`:'';
  const inPacks=(qty,a)=>a?.packName&&a.packSize?` · ${new Intl.NumberFormat('es-MX',{maximumFractionDigits:2}).format(qty/a.packSize)} ${a.packName.toLowerCase()}${qty/a.packSize===1?'':'s'}`:'';
  // Adds a "capture unit" selector next to each quantity of an article that has a pack.
  // The amount is converted to base units right before the form is sent.
  function setupPacks(formEl){
    if(!formEl||formEl.dataset.packs)return;formEl.dataset.packs='1';
    const articleFor=input=>{const scope=input.closest('.request-line,.purchase-line')||formEl;return article(scope.querySelector('select[name="articleId"]')?.value)||article(batchOf(scope.querySelector('select[name="batchId"]')?.value||'')?.articleId);};
    const sync=()=>{
      for(const input of formEl.querySelectorAll('input[name="quantity"]')){
        const a=articleFor(input),current=input.parentElement.querySelector('.pack-unit');
        if(!a?.packSize){current?.parentElement.remove();continue;}
        const key=a.id+'|'+a.packSize;if(current?.dataset.key===key)continue;current?.parentElement.remove();
        const wrap=document.createElement('span');wrap.className='pack-row';
        wrap.innerHTML=`<select class="pack-unit" data-key="${esc(key)}" aria-label="Capturar en"><option value="1">${esc(a.unit)}</option><option value="${a.packSize/1000}">${esc(a.packName)} (${number(a.packSize)} ${esc(a.unit)})</option></select><small class="pack-hint"></small>`;
        input.after(wrap);
        const select=wrap.querySelector('select'),hint=wrap.querySelector('small');
        const show=()=>{const factor=Number(select.value);hint.textContent=factor===1?'':`= ${number(Math.round(Number(input.value||0)*factor*1000))} ${a.unit}`;};
        select.addEventListener('change',()=>{input.step=select.value==='1'?(a.unit==='pzas'?'1':'0.001'):'1';show();});input.addEventListener('input',show);
      }
    };
    formEl.addEventListener('change',e=>{if(e.target.matches('select[name="articleId"],select[name="batchId"]'))sync();});
    new MutationObserver(()=>sync()).observe(formEl,{childList:true,subtree:true});
    formEl.addEventListener('submit',()=>{
      for(const select of formEl.querySelectorAll('.pack-unit')){const factor=Number(select.value);if(factor===1)continue;const input=select.closest('label').querySelector('input[name="quantity"]');input.value=String(Math.round(Number(input.value)*factor*1000)/1000);select.value='1';select.dispatchEvent(new Event('change'));}
    },true);
    sync();
  }

  // ---------- Ubicaciones y lista de surtido ----------
  const byLocation=(x,y)=>(x.location||'~').localeCompare(y.location||'~',undefined,{numeric:true});
  function locationForm(b){form('Ubicación del lote',`<p>${esc(article(b.articleId)?.name)} · Lote ${esc(b.lot)} · ${esc(wh(b.warehouseId))}</p>`+optional('Ubicación (pasillo-rack-nivel)','location','text','maxlength="30" autocomplete="off" placeholder="Ej. A-03-2"')+'<p class="note">La ubicación ordena la lista de surtido y las hojas de conteo para recorrer el almacén una sola vez.</p>','/batches/'+b.id,'PATCH',{location:b.location||''});}
  function printPicking(r){
    const rows=requestItems(r).flatMap(item=>item.allocations.map(a=>({a,b:batchOf(a.batchId),art:article(item.articleId),pending:a.qty-(a.dispatched||0)}))).filter(x=>x.pending>0).sort((x,y)=>byLocation(x.b||{},y.b||{}));
    printDoc('Lista de surtido',r.reference,[['Destino',esc(r.destination)],['Almacén',esc(wh(r.warehouseId))],['Solicitó',esc(r.createdByName)],['Estado',esc(r.status)]],docTable(['Ubicación','SKU','Artículo','Lote','Caducidad','Por surtir','Surtido'],rows.map(x=>[esc(x.b?.location||'Sin ubicación'),esc(x.art?.sku),esc(x.art?.name),esc(x.b?.lot||'—'),esc(x.b?.expiry?shortDate(x.b.expiry):'—'),`${number(x.pending)} ${esc(x.art?.unit)}${esc(inPacks(x.pending,x.art))}`,'<span class="blank"></span>'])),{signatures:['Surtió','Verificó','Recibió']});
  }

  // ---------- Conteos cíclicos con aprobación ----------
  const sessionProgress=c=>`${c.lines.filter(l=>l.counted!==null).length} de ${c.lines.length}`;
  const sessionDiffs=c=>c.lines.filter(l=>l.counted!==null&&l.counted!==l.expected);
  const diffValue=lines=>lines.reduce((n,l)=>n+(pesosOf(l.counted-l.expected,batchOf(l.batchId)?.unitCost??null)||0),0);
  function countsView(){
    const sessions=state.countSessions||[];
    let html=`<p class="note">1. Almacén abre el conteo y captura lo que encuentra (a ciegas si se elige). 2. Lo envía a revisión. 3. El administrador revisa las diferencias y aprueba: los ajustes se aplican juntos y quedan en Movimientos y Kardex. Los movimientos hechos mientras el conteo estaba abierto se respetan.</p>`;
    return html+table(['Referencia / fecha','Almacén','Estado','Avance','Diferencias','Acciones'],sessions.map(c=>{
      const diffs=sessionDiffs(c),value=diffValue(diffs);let actions=button('Ver','count-view',c.id);
      if(c.status==='Abierto'&&allow('almacen'))actions=button('Capturar','count-capture',c.id,true)+button('Hoja','count-print',c.id)+button('Cancelar','count-cancel',c.id);
      if(c.status==='En revisión')actions=(allow()?button('Revisar y aprobar','count-review',c.id,true):button('Ver','count-view',c.id))+(allow('almacen')?button('Cancelar','count-cancel',c.id):'');
      const pillClass={'Abierto':'gray','En revisión':'amber','Aprobado':'','Cancelado':'red'}[c.status];
      return[`${esc(c.reference)}<br>${date(c.createdAt)}<br><small>${esc(c.createdByName)}</small>`,`${esc(wh(c.warehouseId))}${c.kind?`<br><small>${esc(c.kind)}</small>`:''}`,tag(c.status,pillClass)+(c.blind?'<br><small>A ciegas</small>':''),sessionProgress(c),c.status==='Aprobado'?`${c.adjusted||0} ajuste(s) aplicados`:diffs.length?`${diffs.length} lote(s)${value?` · ${esc(money(value))}`:''}`:'—',`<div class="row-actions">${actions}</div>`];
    }));
  }
  function newCountForm(){
    modal('Nuevo conteo cíclico',`<form id="count-session-form" class="auth-form">${warehouses('Almacén')}<label class="field">Tipo de artículo<select name="kind"><option value="">Todos</option><option>Mercancía</option><option>Insumo</option><option>Producto terminado</option></select></label>${field('Referencia del conteo','reference','text','CC-'+day().replaceAll('-',''))}<label class="check-inline"><input type="checkbox" name="blind" checked> Conteo a ciegas (quien cuenta no ve la cantidad del sistema)</label><p class="note">Se congelan las cantidades esperadas de cada lote con existencia del almacén (máximo 200 lotes), ordenadas por ubicación.</p><p id="count-session-error" class="auth-message" role="alert" hidden></p><div class="modal-actions">${button('Cancelar','close')}<button class="button primary" type="submit">Abrir conteo</button></div></form>`);
    const f=$('count-session-form'),operationId=crypto.randomUUID();
    f.onsubmit=async e=>{e.preventDefault();const submit=f.querySelector('[type="submit"]'),error=$('count-session-error');submit.disabled=true;error.hidden=true;try{const c=await api('/count-sessions','POST',{_operationId:operationId,warehouseId:f.elements.namedItem('warehouseId').value,kind:f.elements.namedItem('kind').value,reference:f.elements.namedItem('reference').value,blind:f.elements.namedItem('blind').checked});$('modal').close();await refresh();toast('Conteo abierto.');if(c?.id)captureCount(state.countSessions.find(x=>x.id===c.id));}catch(ex){error.textContent=ex.message;error.hidden=false;}finally{submit.disabled=false;}};
  }
  function captureCount(c){
    if(!c)return;const showExpected=!c.blind||allow();
    const rows=c.lines.map(l=>{const a=article(l.articleId);return `<tr data-batch="${esc(l.batchId)}"><td>${esc(l.location||'—')}</td><td>${esc(a?.sku)} · ${esc(a?.name)}</td><td>${esc(l.lot)}</td>${showExpected?`<td>${number(l.expected)}</td>`:''}<td><input class="filter count-input" type="number" min="0" step="${a?.unit==='pzas'?'1':'0.001'}" inputmode="decimal" value="${l.counted===null?'':l.counted/1000}" aria-label="Contado de ${esc(a?.name)} lote ${esc(l.lot)}"> ${esc(a?.unit)}</td></tr>`;}).join('');
    modal('Capturar conteo · '+c.reference,`<form id="count-capture-form" class="auth-form"><div class="scan-bar"><label class="field">Escanear lote<input type="text" autocomplete="off" placeholder="Etiqueta de lote o número de lote y Enter"></label><span class="scan-status" role="status"></span></div><p class="note">${esc(wh(c.warehouseId))} · ${c.blind?'Conteo a ciegas':'Con cantidad del sistema'} · Deja vacío lo que no contaste.</p><div class="table-scroll"><table class="count-table"><thead><tr><th>Ubicación</th><th>Artículo</th><th>Lote</th>${showExpected?'<th>Sistema</th>':''}<th>Contado</th></tr></thead><tbody>${rows}</tbody></table></div><p id="count-capture-error" class="auth-message" role="alert" hidden></p><div class="modal-actions">${button('Cerrar','close')}<button class="button" type="submit" value="save">Guardar avance</button><button class="button primary" type="submit" value="submit">Enviar a revisión</button></div></form>`);
    $('modal').classList.add('wide');
    const f=$('count-capture-form'),scan=f.querySelector('.scan-bar input'),status=f.querySelector('.scan-status'),recordId=crypto.randomUUID(),submitId=crypto.randomUUID();
    scan.addEventListener('keydown',e=>{if(e.key!=='Enter')return;e.preventDefault();const r=resolveCode(scan.value);scan.value='';const row=r?.type==='batch'&&f.querySelector(`tr[data-batch="${CSS.escape(r.batch.id)}"]`);
      if(row){const input=row.querySelector('input');input.focus();input.select();row.classList.add('scanned');status.textContent=`Lote ${r.batch.lot}: captura la cantidad.`;status.classList.remove('error');}else{status.textContent=r?'Ese lote no está en este conteo.':'Código no encontrado.';status.classList.add('error');}});
    f.querySelectorAll('.count-input').forEach(input=>input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();scan.focus();}}));
    f.onsubmit=async e=>{e.preventDefault();const send=e.submitter?.value==='submit',error=$('count-capture-error');error.hidden=true;f.querySelectorAll('[type="submit"]').forEach(b=>b.disabled=true);
      try{const lines=[...f.querySelectorAll('tr[data-batch]')].map(tr=>({batchId:tr.dataset.batch,counted:tr.querySelector('input').value}));
        await api('/count-sessions/'+c.id,'PATCH',{_operationId:recordId+'-'+Date.now().toString(36),action:'record',lines});
        if(send)await api('/count-sessions/'+c.id,'PATCH',{_operationId:submitId,action:'submit'});
        $('modal').close();await refresh();toast(send?'Conteo enviado a revisión.':'Avance guardado.');}
      catch(ex){error.textContent=ex.message;error.hidden=false;}finally{f.querySelectorAll('[type="submit"]').forEach(b=>b.disabled=false);}};
  }
  function reviewCount(c,readOnly=false){
    const counted=c.lines.filter(l=>l.counted!==null),diffs=sessionDiffs(c),value=diffValue(diffs);
    const rows=counted.map(l=>{const a=article(l.articleId),d=l.counted-l.expected,v=pesosOf(d,batchOf(l.batchId)?.unitCost??null);return[esc(l.location||'—'),`${esc(a?.sku)} · ${esc(a?.name)}`,esc(l.lot),number(l.expected),number(l.counted),d?tag((d>0?'+':'−')+number(Math.abs(d)),d>0?'':'red'):'0',v?esc(money(v)):'—',esc(l.countedBy||'')];});
    const actions=readOnly||c.status!=='En revisión'||!allow()?button('Cerrar','close'):`${button('Reabrir para corregir','count-reopen',c.id)}${button('Aprobar ajustes','count-approve',c.id,true)}`;
    modal(`Conteo ${c.reference} · ${c.status}`,`<p>${esc(wh(c.warehouseId))} · Contados ${sessionProgress(c)} lotes · ${diffs.length} con diferencia${value?` · Valor neto ${esc(money(value))}`:''}</p>`+table(['Ubicación','Artículo','Lote','Sistema al abrir','Contado','Diferencia','Valor','Contó'],rows)+`<p class="note">Al aprobar, cada diferencia se suma a la existencia actual del lote (respetando lo que se movió durante el conteo). Los lotes sin capturar no se ajustan.</p><div class="modal-actions">${actions}</div>`);
  }
  function printCountSession(c){
    printDoc('Hoja de conteo cíclico',c.reference,[['Almacén',esc(wh(c.warehouseId))],['Tipo',c.blind?'A ciegas':'Con cantidad del sistema'],['Abrió',esc(c.createdByName)]],docTable(['Ubicación','SKU','Artículo','Lote','Unidad',...(c.blind?[]:['Sistema']),'Contado'],c.lines.map(l=>{const a=article(l.articleId);return[esc(l.location||'—'),esc(a?.sku),esc(a?.name),esc(l.lot),esc(a?.unit),...(c.blind?[]:[number(l.expected)]),'<span class="blank"></span>'];})),{signatures:['Contó','Verificó','Autorizó']});
  }

  // ---------- Avisos (campana) ----------
  let inboxSeen='',inboxKnown=null;
  const myName=()=>window.nexoAuth?.user()?.name||'';
  function inboxItems(){
    if(!state)return[];const items=[],today=day()+'T06:00:00.000Z';
    for(const r of state.requests.filter(r=>r.createdBy===state.userId))for(const h of (r.history||[]).slice(1))if(h.actor!==myName())items.push({key:'req-'+r.id+'-'+h.at,at:h.at,text:`Tu solicitud ${r.reference} cambió a «${h.status}»`,link:'#requests'});
    if(allow('almacen')){
      for(const r of state.requests.filter(r=>r.status==='Pendiente'&&r.createdBy!==state.userId))items.push({key:'new-'+r.id,at:r.createdAt,text:`Nueva solicitud ${r.reference} de ${r.createdByName} para ${r.destination}`,link:'#requests'});
      for(const t of state.transfers.filter(t=>t.status==='Enviada'))items.push({key:'tr-'+t.id,at:t.history?.at(-1)?.at||t.createdAt,text:`Transferencia ${t.reference} en tránsito: ${wh(t.sourceWarehouseId)} → ${wh(t.destinationWarehouseId)}`,link:'#transfers'});
      const urgent=expiring(7).length;if(urgent)items.push({key:'exp-'+day(),at:today,text:`${urgent} lote(s) caducados o por caducar en 7 días`,link:'#alerts'});
    }
    if(allow())for(const c of (state.countSessions||[]).filter(c=>c.status==='En revisión'))items.push({key:'cnt-'+c.id,at:c.history?.at(-1)?.at||c.createdAt,text:`Conteo ${c.reference} listo para revisión`,link:'#counts'});
    if(allow('compras')){const n=replenishRows().filter(r=>r.suggested>0).length;if(n)items.push({key:'buy-'+day(),at:today,text:`${n} artículo(s) por debajo del punto de reorden`,link:'#replenish'});}
    return items.sort((x,y)=>y.at.localeCompare(x.at)).slice(0,40);
  }
  function ensureBell(){
    const slot=document.querySelector('.top-right');if(!slot||!state)return;
    let bell=$('inbox-bell');
    if(!bell){bell=document.createElement('button');bell.type='button';bell.id='inbox-bell';bell.className='inbox-bell';bell.dataset.op='inbox';bell.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span class="inbox-count" hidden></span>';}
    if(bell.parentElement!==slot)slot.prepend(bell);
    const unread=inboxItems().filter(i=>i.at>inboxSeen).length,count=bell.querySelector('.inbox-count');
    count.hidden=!unread;count.textContent=unread>9?'9+':String(unread);
    bell.setAttribute('aria-label',unread?`Avisos: ${unread} sin leer`:'Avisos');bell.title=bell.getAttribute('aria-label');
  }
  async function openInbox(){
    const items=inboxItems(),seen=inboxSeen;
    modal('Avisos',items.length?`<ul class="inbox-list">${items.map(i=>`<li class="${i.at>seen?'unread':''}"><a href="${i.link}" data-op="close">${esc(i.text)}</a><small>${esc(i.at.endsWith('T06:00:00.000Z')?'Hoy':date(i.at))}</small></li>`).join('')}</ul>`:'<p>No hay avisos por ahora.</p>');
    inboxSeen=new Date().toISOString();await idb.set('inbox-seen:'+state.userId,inboxSeen);ensureBell();
  }
  // Tells the user (once) about notices that appeared since the previous refresh.
  async function announceInbox(){
    const items=inboxItems(),keys=new Set(items.map(i=>i.key));
    if(inboxKnown){const fresh=items.filter(i=>!inboxKnown.has(i.key)&&i.at>inboxSeen);
      if(fresh.length){toast(fresh.length===1?fresh[0].text:`${fresh.length} avisos nuevos. Abre la campana para verlos.`);
        try{if('Notification'in window&&Notification.permission==='granted'&&document.hidden){const options={body:fresh.map(i=>i.text).slice(0,3).join('\n'),icon:'/icons/icon-192.png',tag:'nexo-inbox'};(navigator.serviceWorker?.ready||Promise.reject()).then(r=>r.showNotification('Nexo',options)).catch(()=>new Notification('Nexo',options));}}catch{}}}
    inboxKnown=keys;
  }
  async function loadInboxSeen(){if(inboxSeen||!state)return;inboxSeen=(await idb.get('inbox-seen:'+state.userId))||'';}

  // ---------- Bitácora ----------
  let auditData=null,auditError='',auditVersion=0;const auditFilter={actor:'',kind:'',q:''};
  const AUDIT_LABELS={'session.login':'Inició sesión','session.google':'Inició sesión con Google','session.mobile.google':'Inició sesión en la app móvil','account.register':'Solicitó una cuenta','account.google.register':'Solicitó una cuenta con Google','profile.update':'Actualizó su perfil','password.change':'Cambió su contraseña','access.update':'Cambió el acceso de un usuario','access.email.approved':'Preaprobó un correo','access.email.revoked':'Retiró una preaprobación','access.email.claimed':'Activó un acceso preaprobado','admin.bootstrap':'Creó el administrador inicial'};
  const ACTION_LABELS={approve:'aprobar',dispatch:'despachar',receive:'recibir',cancel:'cancelar',send:'enviar',reject:'rechazar',record:'capturar',submit:'enviar a revisión',reopen:'reabrir'};
  function auditLabel(r){
    if(AUDIT_LABELS[r.action])return AUDIT_LABELS[r.action];
    if(r.action.startsWith('inventory/')){const path=r.action.slice('inventory'.length),base=labels[path.split('/')[1]]||'Operación de inventario';return base+(r.details?.action?` · ${ACTION_LABELS[r.details.action]||r.details.action}`:r.details?.method==='PATCH'?' (actualización)':'');}
    return r.action;
  }
  const auditDetail=r=>{const d=r.details||{},parts=[];if(r.target)parts.push('Usuario: '+r.target);if(d.reference)parts.push('Ref. '+d.reference);if(d.name)parts.push(d.name);if(d.count)parts.push(d.count+' registro(s)');if(d.role)parts.push('Rol: '+d.role);if(d.status)parts.push('Estado: '+d.status);if(d.email)parts.push(d.email);return parts.join(' · ');};
  async function loadAudit(){const version=++auditVersion;try{const data=await api('/audit');if(version!==auditVersion)return;auditData=data;auditError='';}catch(e){if(version!==auditVersion)return;auditError=e.message;}if(route==='audit')render();}
  const auditRows=()=>(auditData||[]).filter(r=>(!auditFilter.actor||r.actorId===auditFilter.actor)&&(!auditFilter.kind||(auditFilter.kind==='inventory')===r.action.startsWith('inventory/'))&&(!auditFilter.q||normalized(auditLabel(r)+' '+auditDetail(r)+' '+r.actor).includes(normalized(auditFilter.q))));
  function auditView(){
    if(auditError&&!auditData)return `<section class="panel onboarding"><h2>No se pudo cargar la bitácora</h2><p>${esc(auditError)}</p>${button('Reintentar','audit-retry')}</section>`;
    if(!auditData){loadAudit();return '<section class="panel empty" role="status">Cargando bitácora…</section>';}
    const actors=[...new Map(auditData.map(r=>[r.actorId,r.actor])).entries()],rows=auditRows();
    let html=`<div class="toolbar"><label class="field inline">Usuario<select id="audit-actor" class="filter"><option value="">Todos</option>${actors.map(([id,name])=>`<option value="${esc(id)}" ${id===auditFilter.actor?'selected':''}>${esc(name)}</option>`).join('')}</select></label><label class="field inline">Tipo<select id="audit-kind" class="filter"><option value="">Todo</option><option value="inventory" ${auditFilter.kind==='inventory'?'selected':''}>Operaciones de inventario</option><option value="access" ${auditFilter.kind==='access'?'selected':''}>Accesos y usuarios</option></select></label><input id="audit-q" class="filter" placeholder="Buscar referencia, nombre o acción" aria-label="Buscar en la bitácora" value="${esc(auditFilter.q)}">${button('Exportar CSV','export-audit')}${button('Recargar','audit-retry')}</div>`;
    html+=table(['Fecha','Usuario','Acción','Detalle'],rows.slice(0,300).map(r=>[date(r.at),esc(r.actor),esc(auditLabel(r)),esc(auditDetail(r))||'—']));
    return html+`<p class="note">Muestra los últimos 500 registros del servidor (${rows.length} con los filtros actuales; se listan hasta 300). La bitácora no se puede modificar desde la aplicación.</p>`;
  }
  const exportAudit=()=>downloadCSV([['Fecha','Usuario','Acción','Detalle'],...auditRows().map(r=>[date(r.at),r.actor,auditLabel(r),auditDetail(r)])],'bitacora-'+day()+'.csv');

  function exportCSV(){const rows=[['SKU','Artículo','Almacén','Físico','Reservado','Disponible','Unidad'],...state.articles.filter(a=>`${a.sku} ${a.name}`.toLowerCase().includes(query.toLowerCase())).flatMap(a=>state.warehouses.filter(w=>!warehouse||w.id===warehouse).map(w=>{const t=totals(a.id,w.id);return[a.sku,a.name,w.name,t.physical/1000,t.reserved/1000,t.available/1000,a.unit];}))];const csv=rows.map(row=>row.map(v=>'"'+String(v).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='inventario-'+day()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  document.addEventListener('click',async e=>{const b=e.target.closest('[data-op]');if(!b)return;const op=b.dataset.op,id=b.dataset.id;
    try{
      if(op==='close')return $('modal').close();if(op==='refresh')return refresh();if(op==='sync')return refresh();if(op==='pending')return pendingList();if(op==='discard-op'){await idb.remove(id);offline.queue=await idb.queue();$('modal').close();render();return;}if(op==='metrics-retry'){metricsData=null;metricsError='';return render();}if(op==='next'||op==='previous'){page+=op==='next'?1:-1;return render();}if(op==='export')return exportCSV();
      if(op==='article')articleForm();
      if(op==='import-articles')importArticles();
      if(op==='import-inventory')importInventory();
      if(op==='edit-article')articleForm(article(id));
      if(op==='warehouse')form('Nuevo almacén',field('Nombre','name')+field('Ubicación','location'),'/warehouses');
      if(op==='partner')form('Empresa / punto de venta',field('Nombre','name')+select('Tipo','kind',[['Proveedor','Proveedor'],['Cliente','Cliente'],['Punto de venta','Punto de venta']])+field('Dirección o referencia','reference'),'/partners');
      if(op==='policy')form('Mínimo por artículo y almacén',articles()+warehouses()+field('Stock mínimo','minimum','number','0','min="0" step="1"')+'<p class="note">La alerta aparece cuando el disponible es menor al mínimo. Se suman todos los lotes utilizables del artículo en ese almacén.</p>','/policies');
      if(op==='receipt')receipt();if(op==='receive-purchase')receipt(state.purchases.find(p=>p.id===id));
      if(op==='issue')form('Salida automática PEPS',articles()+warehouses()+partners('Destino')+qty()+field('Documento de entrega','reference')+'<p class="note">Se consumirán primero las recepciones más antiguas disponibles. El historial identificará los lotes y el destinatario.</p>','/issues');
      if(op==='transfer')form('Preparar transferencia',articles()+warehouses('Almacén de origen','sourceWarehouseId')+warehouses('Almacén de destino','destinationWarehouseId')+qty()+field('Referencia de transferencia','reference')+'<p class="note">Se reservarán por PEPS las existencias disponibles. Después deberás marcar la transferencia como Enviada y finalmente Recibida o Rechazada.</p>','/transfers');
      if(op==='count')physicalCount();
      if(op==='waste')wasteForm();if(op==='waste-batch'){const b=batchOf(id);wasteForm({batchId:id,...(b?.expiry&&b.expiry<day()?{reason:'Caducidad'}:{})});}
      if(op==='customer-return')form('Recibir devolución de cliente',select('Artículo y lote originalmente despachado','batchId',state.batches.filter(b=>returnable(b)>0).map(b=>[b.id,`${article(b.articleId)?.name} · lote ${b.lot} · máximo ${number(returnable(b))} ${article(b.articleId)?.unit}`]))+warehouses('Almacén que recibe','warehouseId')+partners('Destino')+qty()+select('Motivo','reason',[['Producto no utilizado','Producto no utilizado'],['Producto incorrecto','Producto incorrecto'],['Producto dañado','Producto dañado'],['Otro','Otro']])+field('Referencia de devolución','reference')+'<p class="note">Se creará una nueva capa con el mismo lote y caducidad. La cantidad no puede superar lo que salió de ese lote y aún no ha regresado.</p>','/returns/customer');
      if(op==='supplier-return')supplierReturnForm();if(op==='return-batch'){const b=batchOf(id);supplierReturnForm({batchId:id,...(b?.partnerId&&state.partners.some(p=>p.id===b.partnerId&&p.kind==='Proveedor')?{partnerId:b.partnerId}:{}),reason:'Caducidad próxima'});}
      if(op==='purchase')purchaseForm();
      if(op==='scan')scanModal();if(op==='label-batch')labelDialog('batch',id);if(op==='label-article')labelDialog('article',id);
      if(op==='print-event')printEvent(state.events.find(x=>x.id===id));if(op==='print-purchase')printPurchase(state.purchases.find(x=>x.id===id));if(op==='print-remission')printRemission(state.requests.find(x=>x.id===id));
      if(op==='count-sheet')countSheetDialog();if(op==='print-kardex')printKardex();if(op==='export-kardex')exportKardex();if(op==='print-alerts')printAlerts();
      if(op==='open-kardex'){kardex.articleId=id;$('modal').close();location.hash='#kardex';}
      if(op==='notify-expiry'){const result=await Notification.requestPermission();if(result==='granted'){await notifyExpiry(true);toast('Avisos activados en este navegador.');}else toast('El navegador no permitió los avisos.');render();}
      if(op==='create-suggested')await createSuggested(b);
      if(op==='count-new')newCountForm();
      const session=id&&state.countSessions?.find(x=>x.id===id);
      if(op==='count-capture')captureCount(session);if(op==='count-view')reviewCount(session,true);if(op==='count-review')reviewCount(session);if(op==='count-print')printCountSession(session);
      if(['count-cancel','count-reopen','count-approve'].includes(op)){if(op!=='count-reopen'&&!confirm(op==='count-approve'?'¿Aplicar todos los ajustes de este conteo? Quedarán registrados en Movimientos y Kardex.':'¿Cancelar este conteo? Lo capturado no se aplicará.'))return;b.disabled=true;b.dataset.operationId||=crypto.randomUUID();await api('/count-sessions/'+id,'PATCH',{action:op.replace('count-',''),_operationId:b.dataset.operationId});if($('modal').open)$('modal').close();await refresh();toast(op==='count-approve'?'Ajustes aplicados.':op==='count-reopen'?'Conteo reabierto para corrección.':'Conteo cancelado.');}
      if(op==='inbox')await openInbox();
      if(op==='locate')locationForm(batchOf(id));if(op==='print-picking')printPicking(state.requests.find(x=>x.id===id));
      if(op==='audit-retry'){auditData=null;auditError='';render();}if(op==='export-audit')exportAudit();
      if(op==='request')requestForm();
      if(op==='company')form('Nombre y logo del cliente',field('Nombre comercial','name','text',state.company.name)+'<label class="field">Logo (PNG, JPEG o WebP, máximo 5 MB; ajuste automático)<input type="file" name="logoFile" accept="image/png,image/jpeg,image/webp"></label><label><input type="checkbox" name="removeLogo"> Quitar logo actual</label>','/company','PATCH',{logo:state.company.logo});
      if(op==='dispatch')dispatchRequest(state.requests.find(r=>r.id===id));
      if(['transfer-send','transfer-receive','transfer-reject','transfer-cancel'].includes(op)){b.disabled=true;b.dataset.operationId||=crypto.randomUUID();await api('/transfers/'+id,'PATCH',{action:op.replace('transfer-',''),_operationId:b.dataset.operationId});await refresh();toast('Transferencia actualizada.');}
      if(['approve','receive','cancel'].includes(op)){b.disabled=true;b.dataset.operationId||=crypto.randomUUID();await api('/requests/'+id,'PATCH',{action:op,_operationId:b.dataset.operationId});await refresh();toast('Solicitud actualizada.');}
      if(op==='trace'){const batch=state.batches.find(x=>x.id===id);modal('Trazabilidad · '+batch.lot,`<p>${esc(article(batch.articleId)?.name)} · ${esc(wh(batch.warehouseId))}</p>`+table(['Fecha','Evento','Cantidad','Origen / destino','Responsable / documento'],state.events.filter(x=>x.batchId===id).sort((a,b)=>a.at.localeCompare(b.at)).map(x=>[date(x.at),esc(x.type),number(x.qty),esc(x.destinationWarehouseId?wh(x.destinationWarehouseId):x.sourceWarehouseId?wh(x.sourceWarehouseId):x.destination||partner(x.partnerId)),`${esc(x.actorName)}<br>${esc(x.reference)}`])));}
      if(op==='request-detail'){const r=state.requests.find(x=>x.id===id),allocations=requestItems(r).flatMap(item=>item.allocations.map(a=>[`${esc(article(item.articleId)?.name)}<br>${esc(state.batches.find(b=>b.id===a.batchId)?.lot)}`,number(a.qty),number(a.dispatched||0)]));modal('Solicitud · '+r.reference,`<p>Destino: ${esc(r.destination)}</p>`+table(['Estado','Fecha','Responsable'],r.history.map(h=>[pill(h.status),date(h.at),esc(h.actor)]))+(state.role!=='solicitante'?table(['Artículo / lote','Reservado originalmente','Despachado'],allocations):''));}
    }catch(error){toast(error.message);b.disabled=false;}
  });
  const sidebar=$('sidebar'),mobile=matchMedia('(max-width:850px)');
  function menu(open){open=mobile.matches&&open;sidebar.classList.toggle('open',open);sidebar.inert=mobile.matches&&!open;$('menu').setAttribute('aria-expanded',String(open));$('menu-backdrop').hidden=!open;document.body.classList.toggle('menu-open',open);document.querySelector('.main-wrap').inert=open;document.querySelector('.skip-link').inert=open;if(open){sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');$('menu-close').focus();}else{sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');}}
  $('menu').onclick=()=>menu(!sidebar.classList.contains('open'));$('menu-close').onclick=()=>menu(false);$('menu-backdrop').onclick=()=>menu(false);document.addEventListener('nexo:close-navigation',()=>menu(false));mobile.addEventListener('change',()=>menu(false));document.addEventListener('keydown',e=>{if(e.key==='Escape')menu(false);});menu(false);
  document.querySelector('.skip-link').onclick=e=>{e.preventDefault();$('main').focus();};
  sidebar.addEventListener('keydown',e=>{if(e.key!=='Tab'||!sidebar.classList.contains('open'))return;const items=[...sidebar.querySelectorAll('a[href],button:not([disabled])')].filter(n=>n.getClientRects().length),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
  function navigate(event){route=location.hash.slice(1)||'overview';page=0;menu(false);if(state)render();else refresh();if(event){$('main').querySelector('h1')?.focus();window.scrollTo(0,0);}}
  window.addEventListener('hashchange',navigate);
  addEventListener('online',()=>refresh());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(offline.on||offline.queue.length))refresh();});
  setInterval(()=>{if(offline.on||offline.queue.length)refresh();},30000);
  setInterval(async()=>{
    if(!state||document.hidden||offline.on||offline.queue.length||$('modal').open||document.body.classList.contains('printing'))return;
    if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
    // Cheap check first (one document); the full inventory is downloaded only when something changed.
    try{const {revision}=await request('/revision','GET');if(state.revision&&revision===state.revision)return;
      const next=await request('/snapshot','GET');if(JSON.stringify(next)===JSON.stringify(state))return;const keepMetrics=metricsData;state=next;metricsData=keepMetrics;render();announceInbox();}catch{}
  },60000);
  navigate();
})();
