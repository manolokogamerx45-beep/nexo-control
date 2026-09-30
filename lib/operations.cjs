const {randomUUID,createHash}=require('node:crypto');
const {bad}=require('./auth.cjs');
const now=()=>new Date().toISOString();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const text=(v,label,max=120)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)bad('Revisa '+label+'.');return v.trim();};
function amount(v,unit,zero=false){
  if(!['number','string'].includes(typeof v)||!/^\d+(\.\d{1,3})?$/.test(String(v)))bad('Cantidad inválida: usa hasta tres decimales.');
  const n=Number(v),q=Math.round(n*1000);
  if(!Number.isSafeInteger(q)||q>1e12||q<(zero?0:1)||(unit==='pzas'&&q%1000))bad(unit==='pzas'?'Las piezas requieren cantidades enteras.':'Cantidad fuera de rango.');
  return q;
}
const permitted=(user,roles)=>{if(user.role!=='administrador'&&!roles.includes(user.role))bad('No tienes permiso para esta operación.',403);};
function operations(db){
  const get=(c,id)=>db.operationGet(c,id),list=(c,f,v)=>db.operationList(c,f,v),save=(c,v)=>db.operationSave(c,v.id,v);
  const required=async(c,id)=>{const v=await get(c,id);if(!v)bad('Registro no encontrado.',404);return v;};
  const usable=b=>!b.expiry||b.expiry>=today();
  async function event(actor,type,batch,qty,input={}){
    const row={id:randomUUID(),type,batchId:batch.id,articleId:batch.articleId,warehouseId:batch.warehouseId,qty,at:now(),actorId:actor.id,actorName:actor.name,...input};
    await save('events',row);return row;
  }
  async function allocate(articleId,warehouseId,qty){
    const batches=(await list('batches','articleId',articleId)).filter(b=>b.warehouseId===warehouseId&&usable(b)&&b.quantity>b.reserved).sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)||a.id.localeCompare(b.id));
    const allocations=[];let left=qty;
    for(const b of batches){const n=Math.min(left,b.quantity-b.reserved);if(n>0){allocations.push({batchId:b.id,qty:n});left-=n;}if(!left)break;}
    if(left)bad('Existencias disponibles insuficientes. No se incluyen lotes caducados ni cantidades reservadas.',409);
    if(allocations.length>100)bad('La salida requiere más de 100 recepciones. Divide la cantidad en solicitudes más pequeñas.',409);
    return allocations;
  }
  async function handle(user,method,path,input={}){
    if(method==='GET'&&path==='/snapshot'){
      const [company,articles,warehouses,partners,batches,events,requests,policies,purchases]=await Promise.all([get('settings','company'),list('articles'),list('warehouses'),list('partners'),list('batches'),list('events'),list('requests'),list('policies'),list('purchases')]);
      const requester=user.role==='solicitante';
      return {company:company||{name:'Mi empresa',logo:''},articles,warehouses,partners:requester?[]:partners,batches:requester?[]:batches,events:requester?[]:events.sort((a,b)=>b.at.localeCompare(a.at)),requests:requests.filter(r=>!requester||r.createdBy===user.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),policies:requester?[]:policies,purchases:requester?[]:purchases,role:user.role,userId:user.id};
    }
    if(method!=='POST'&&method!=='PATCH')bad('Método no permitido.',405);
    return db.transaction(async()=>{
      const current=await db.getUser(user.id);
      if(!current||current.status!=='active'||current.role!==user.role)bad('El acceso cambió. Inicia sesión nuevamente.',403);
      const operationId=input._operationId;
      if(operationId!==undefined&&(typeof operationId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(operationId)))bad('Identificador de operación inválido.');
      const key=operationId?user.id+'_'+operationId:null;
      const fingerprint=createHash('sha256').update(JSON.stringify({method,path,input})).digest('hex');
      if(key){const previous=await get('commands',key);if(previous){if(previous.fingerprint!==fingerprint)bad('Esta operación ya se usó con otros datos. Abre un formulario nuevo.',409);return previous.result;}}
      let result;
      if(path==='/company'&&method==='PATCH'){
        permitted(user,[]);const name=text(input.name,'nombre de la empresa',80),logo=input.logo||'';
        if(typeof logo!=='string'||logo.length>45000||(logo&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo)))bad('Usa un logo PNG, JPEG o WebP de hasta 32 KB.');
        result={id:'company',name,logo};await save('settings',result);
      } else if(path==='/warehouses'&&method==='POST'){
        permitted(user,[]);result={id:randomUUID(),name:text(input.name,'nombre del almacén'),location:text(input.location,'ubicación')};await save('warehouses',result);
      } else if(path==='/partners'&&method==='POST'){
        permitted(user,['compras']);if(!['Proveedor','Cliente','Punto de venta'].includes(input.kind))bad('Tipo de empresa inválido.');
        result={id:randomUUID(),name:text(input.name,'nombre'),kind:input.kind,reference:text(input.reference,'referencia o dirección',200)};await save('partners',result);
      } else if(path==='/articles'&&method==='POST'){
        permitted(user,['compras']);const sku=text(input.sku,'SKU',40).toUpperCase();
        if(!['pzas','kg','L'].includes(input.unit)||!['Insumo','Producto terminado','Mercancía'].includes(input.kind))bad('Unidad o tipo inválido.');
        if((await list('articles','sku',sku)).length)bad('El SKU ya existe.',409);
        result={id:randomUUID(),sku,name:text(input.name,'nombre'),unit:input.unit,kind:input.kind,active:true,rotation:'PEPS'};await save('articles',result);
      } else if(/^\/articles\/[^/]+$/.test(path)&&method==='PATCH'){
        permitted(user,['compras']);result=await required('articles',path.split('/')[2]);
        if(typeof input.active!=='boolean')bad('Estado inválido.');result={...result,name:text(input.name,'nombre'),active:input.active};await save('articles',result);
      } else if(path==='/policies'&&method==='POST'){
        permitted(user,['almacen']);const article=await required('articles',input.articleId);await required('warehouses',input.warehouseId);
        result={id:article.id+'_'+input.warehouseId,articleId:article.id,warehouseId:input.warehouseId,minimum:amount(input.minimum,article.unit,true)};await save('policies',result);
      } else if(path==='/receipts'&&method==='POST'){
        permitted(user,['almacen']);const article=await required('articles',input.articleId);if(!article.active)bad('Artículo desactivado.');
        await required('warehouses',input.warehouseId);const partner=await required('partners',input.partnerId);if(partner.kind!=='Proveedor')bad('Selecciona un proveedor.');
        const qty=amount(input.quantity,article.unit),lot=text(input.lot,'lote',60),reference=text(input.reference,'documento de recepción',80);
        const expiry=input.expiry||null;
        if(expiry&&(!/^\d{4}-\d{2}-\d{2}$/.test(expiry)||!Number.isFinite(Date.parse(expiry))||new Date(expiry).toISOString().slice(0,10)!==expiry||expiry<today()))bad('Caducidad inválida o vencida.');
        // One receipt layer per batch keeps FIFO ordering even when a lot is replenished.
        result={id:randomUUID(),articleId:article.id,warehouseId:input.warehouseId,partnerId:partner.id,lot,expiry,quantity:qty,reserved:0,receivedAt:now(),reference};
        if(input.purchaseId){const p=await required('purchases',input.purchaseId);if(p.articleId!==article.id||p.partnerId!==partner.id||p.received+qty>p.quantity)bad('La recepción no coincide con la orden o supera lo pendiente.',409);p.received+=qty;p.status=p.received===p.quantity?'Recibida':'Recepción parcial';await save('purchases',p);result.purchaseId=p.id;}
        await save('batches',result);await event(user,'Entrada',result,qty,{reference,partnerId:partner.id});
      } else if(path==='/issues'&&method==='POST'){
        permitted(user,['almacen']);const article=await required('articles',input.articleId);const qty=amount(input.quantity,article.unit);await required('warehouses',input.warehouseId);
        const partner=await required('partners',input.partnerId);if(partner.kind==='Proveedor')bad('Selecciona un cliente o punto de venta.');
        const reference=text(input.reference,'referencia',80),allocations=await allocate(article.id,input.warehouseId,qty);
        for(const a of allocations){const b=await required('batches',a.batchId);b.quantity-=a.qty;await save('batches',b);await event(user,'Salida PEPS',b,a.qty,{reference,partnerId:partner.id});}result={allocations};
      } else if(path==='/waste'&&method==='POST'){
        permitted(user,['almacen']);const b=await required('batches',input.batchId),article=await required('articles',b.articleId),qty=amount(input.quantity,article.unit);
        if(qty>b.quantity-b.reserved)bad('La merma supera la cantidad no reservada.',409);
        const reason=text(input.reason,'causa de merma',200);b.quantity-=qty;await save('batches',b);result=await event(user,'Merma',b,qty,{reference:reason});
      } else if(path==='/purchases'&&method==='POST'){
        permitted(user,['compras']);const a=await required('articles',input.articleId),p=await required('partners',input.partnerId);if(p.kind!=='Proveedor'||!a.active)bad('Selecciona un artículo activo y un proveedor.');
        result={id:randomUUID(),articleId:a.id,partnerId:p.id,quantity:amount(input.quantity,a.unit),received:0,status:'Emitida',reference:text(input.reference,'referencia',80),createdAt:now()};await save('purchases',result);
      } else if(path==='/requests'&&method==='POST'){
        permitted(user,['solicitante','compras','almacen']);const a=await required('articles',input.articleId);await required('warehouses',input.warehouseId);if(!a.active)bad('Artículo desactivado.');
        result={id:randomUUID(),articleId:a.id,warehouseId:input.warehouseId,quantity:amount(input.quantity,a.unit),destination:text(input.destination,'empresa / punto de venta destinatario'),reference:text(input.reference,'referencia de la solicitud',80),createdBy:user.id,createdByName:user.name,createdAt:now(),status:'Pendiente',allocations:[],history:[{status:'Pendiente',at:now(),actor:user.name}]};await save('requests',result);
      } else if(/^\/requests\/[^/]+$/.test(path)&&method==='PATCH'){
        const r=await required('requests',path.split('/')[2]),action=input.action;
        if(action==='receive'){if(user.role!=='administrador'&&r.createdBy!==user.id)bad('Solo el solicitante o el administrador puede confirmar la recepción.',403);if(r.status!=='Despachada')bad('Primero debe despacharse la solicitud.',409);r.status='Recibida';}
        else{
          permitted(user,['almacen']);
          if(action==='approve'&&r.status==='Pendiente'){
            r.allocations=await allocate(r.articleId,r.warehouseId,r.quantity);
            for(const a of r.allocations){const b=await required('batches',a.batchId);b.reserved+=a.qty;await save('batches',b);}r.status='Aprobada';
          }else if(action==='dispatch'&&r.status==='Aprobada'){
            for(const a of r.allocations){const b=await required('batches',a.batchId);if(!usable(b))bad('Un lote reservado caducó. Cancela la solicitud y crea otra.',409);b.quantity-=a.qty;b.reserved-=a.qty;await save('batches',b);await event(user,'Despacho',b,a.qty,{requestId:r.id,destination:r.destination,reference:r.reference});}r.status='Despachada';
          }else if(action==='cancel'&&['Pendiente','Aprobada'].includes(r.status)){
            for(const a of r.allocations){const b=await required('batches',a.batchId);b.reserved-=a.qty;await save('batches',b);}r.status='Cancelada';
          }else bad('Transición no permitida.',409);
        }
        r.history.push({status:r.status,at:now(),actor:user.name});await save('requests',r);result=r;
        if(action==='receive')for(const a of r.allocations){const b=await required('batches',a.batchId);await event(user,'Entrega confirmada',b,a.qty,{requestId:r.id,destination:r.destination,reference:r.reference});}
      }else bad('Operación no encontrada.',404);
      await db.saveAudit({id:randomUUID(),actor_id:user.id,target_id:result.id||null,action:'inventory'+path,created_at:now(),details:{method}});
      if(key)await save('commands',{id:key,fingerprint,result,createdAt:now()});
      return result;
    });
  }
  return {handle};
}
module.exports={operations,amount};
