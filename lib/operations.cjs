const {randomUUID,createHash}=require('node:crypto');
const {bad}=require('./auth.cjs');
const metrics=require('./metrics.cjs');
const now=()=>new Date().toISOString();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const text=(v,label,max=120)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)bad('Revisa '+label+'.');return v.trim();};
function amount(v,unit,zero=false){
  if(!['number','string'].includes(typeof v)||!/^\d+(\.\d{1,3})?$/.test(String(v)))bad('Cantidad inválida: usa hasta tres decimales.');
  const n=Number(v),q=Math.round(n*1000);
  if(!Number.isSafeInteger(q)||q>1e12||q<(zero?0:1)||(unit==='pzas'&&q%1000))bad(unit==='pzas'?'Las piezas requieren cantidades enteras.':'Cantidad fuera de rango.');
  return q;
}
// Optional unit cost in MXN with up to two decimals, stored in centavos.
function cost(v,label='costo unitario'){
  if(v===undefined||v===null||v==='')return null;
  if(!['number','string'].includes(typeof v)||!/^\d+(\.\d{1,2})?$/.test(String(v).trim()))bad('Revisa el '+label+': usa pesos con hasta dos decimales.');
  const c=Math.round(Number(v)*100);if(!Number.isSafeInteger(c)||c>1e11)bad('El '+label+' está fuera de rango.');
  return c;
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
  // Optional supply data per article: scannable barcode (EAN/UPC or own code),
  // preferred supplier and supplier lead time, used by purchase suggestions.
  async function supplyFields(input,articleId,sku,previous={},unit=previous.unit){
    // A field left out of the request keeps its previous value (older clients only send name/active).
    input={barcode:previous.barcode,preferredPartnerId:previous.preferredPartnerId,leadTimeDays:previous.leadTimeDays,packName:previous.packName,packSize:previous.packSize===undefined||previous.packSize===null?previous.packSize:previous.packSize/1000,...input};
    const fields={};
    const barcode=input.barcode===undefined||input.barcode===null?'':String(input.barcode).trim();
    if(barcode){
      if(!/^[A-Za-z0-9._-]{4,40}$/.test(barcode))bad('El código de barras debe tener de 4 a 40 letras, números, punto o guion.');
      const code=barcode.toUpperCase();
      if(code===sku)bad('El código de barras no puede repetir el SKU; el SKU ya se puede escanear.');
      const clash=(await list('articles')).find(a=>a.id!==articleId&&(a.barcode===code||a.sku===code));
      if(clash)bad('Ese código ya pertenece a '+clash.name+'.',409);
      fields.barcode=code;
    }else fields.barcode='';
    if(input.preferredPartnerId){const p=await required('partners',input.preferredPartnerId);if(p.kind!=='Proveedor')bad('El proveedor preferido debe ser un proveedor.');fields.preferredPartnerId=p.id;}else fields.preferredPartnerId='';
    const lead=input.leadTimeDays===undefined||input.leadTimeDays===null||input.leadTimeDays===''?null:Number(input.leadTimeDays);
    if(lead!==null&&(!Number.isInteger(lead)||lead<0||lead>365))bad('El tiempo de entrega debe ser de 0 a 365 días.');
    fields.leadTimeDays=lead;
    // Optional purchase/handling pack, e.g. "Caja" of 12 pzas. Input in base units; stored in thousandths like any quantity.
    const packName=input.packName===undefined||input.packName===null?'':String(input.packName).trim();
    const rawSize=input.packSize===undefined||input.packSize===null||input.packSize===''?null:input.packSize;
    if(!packName&&rawSize===null){fields.packName='';fields.packSize=null;}
    else{
      if(!packName||rawSize===null)bad('Indica el nombre del empaque y cuántas unidades base contiene.');
      if(packName.length>20)bad('El nombre del empaque admite hasta 20 caracteres.');
      const size=amount(rawSize,unit);
      if(size<=1000&&unit==='pzas')bad('El empaque debe contener más de una pieza.');
      fields.packName=packName;fields.packSize=size;
    }
    return fields;
  }
  const location=v=>{const t=v===undefined||v===null?'':String(v).trim().toUpperCase();if(t&&!/^[A-Z0-9 ._\/-]{1,30}$/.test(t))bad('La ubicación admite hasta 30 letras, números, espacio, punto, guion o diagonal (ej. A-03-2).');return t;};
  const requestItems=r=>Array.isArray(r.items)?r.items:[{articleId:r.articleId,quantity:r.quantity,allocations:(r.allocations||[]).map(a=>({...a,dispatched:['Despachada','Recibida'].includes(r.status)?a.qty:0}))}];
  const purchaseItems=p=>Array.isArray(p.items)?p.items:[{articleId:p.articleId,quantity:p.quantity,received:p.received||0}];
  async function handle(user,method,path,input={}){
    if(method==='GET'&&path==='/snapshot'){
      const [revision,company,articles,warehouses,partners,batches,events,requests,policies,purchases,transfers,countSessions]=await Promise.all([get('settings','revision'),get('settings','company'),list('articles'),list('warehouses'),list('partners'),list('batches'),list('events'),list('requests'),list('policies'),list('purchases'),list('transfers'),list('countsessions')]);
      const requester=user.role==='solicitante';
      return {company:company||{name:'Mi empresa',logo:''},articles,warehouses,partners:requester?[]:partners,batches:requester?[]:batches,events:requester?[]:events.sort((a,b)=>b.at.localeCompare(a.at)),requests:requests.filter(r=>!requester||r.createdBy===user.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),policies:requester?[]:policies,purchases:requester?[]:purchases,transfers:requester?[]:transfers.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),countSessions:requester?[]:countSessions.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),role:user.role,userId:user.id,revision:revision?.at||''};
    }
    if(method==='GET'&&path==='/revision')return {revision:(await get('settings','revision'))?.at||''};
    if(method==='GET'&&path==='/audit'){
      if(user.role!=='administrador')bad('Solo el administrador puede consultar la bitácora.',403);
      const [rows,users]=await Promise.all([db.listAudit(),db.listUsers()]);const names=new Map(users.map(u=>[u.id,u.name]));
      return rows.sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,500).map(r=>({id:r.id,at:r.created_at,action:r.action,actorId:r.actor_id,actor:names.get(r.actor_id)||'Usuario eliminado',target:r.target_id&&r.target_id!==r.actor_id?names.get(r.target_id)||null:null,details:r.details||{}}));
    }
    const period=method==='GET'&&/^\/metrics(\/\d+)?$/.exec(path);
    if(period){
      if(user.role==='solicitante')bad('No tienes permiso para consultar indicadores.',403);
      const [articles,batches,events]=await Promise.all([list('articles'),list('batches'),list('events')]);
      return metrics.compute({articles,batches,events,months:Number(path.split('/')[2]||6)});
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
        result={id:randomUUID(),sku,name:text(input.name,'nombre'),unit:input.unit,kind:input.kind,active:true,rotation:'PEPS',...await supplyFields(input,null,sku,{},input.unit)};await save('articles',result);
      } else if(path==='/articles/import'&&method==='POST'){
        permitted(user,['compras']);if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>200)bad('El archivo debe contener entre 1 y 200 artículos.');
        const existing=new Set((await list('articles')).map(a=>a.sku)),prepared=[];
        for(let i=0;i<input.rows.length;i++){
          const row=input.rows[i];if(!row||typeof row!=='object'||Array.isArray(row))bad('Revisa la fila '+(i+2)+'.');
          const sku=text(row.sku,'SKU de la fila '+(i+2),40).toUpperCase();
          if(!['pzas','kg','L'].includes(row.unit)||!['Insumo','Producto terminado','Mercancía'].includes(row.kind))bad('Unidad o tipo inválido en la fila '+(i+2)+'.');
          if(existing.has(sku))bad('El SKU '+sku+' está repetido o ya existe.',409);existing.add(sku);
          prepared.push({id:randomUUID(),sku,name:text(row.name,'nombre de la fila '+(i+2)),unit:row.unit,kind:row.kind,active:true,rotation:'PEPS'});
        }
        for(const article of prepared)await save('articles',article);
        result={id:randomUUID(),count:prepared.length};
      } else if(/^\/articles\/[^/]+$/.test(path)&&method==='PATCH'){
        permitted(user,['compras']);result=await required('articles',path.split('/')[2]);
        if(typeof input.active!=='boolean')bad('Estado inválido.');result={...result,name:text(input.name,'nombre'),active:input.active,...await supplyFields(input,result.id,result.sku,result)};await save('articles',result);
      } else if(path==='/inventory/import'&&method==='POST'){
        permitted(user,['almacen']);if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>100)bad('El archivo debe contener entre 1 y 100 existencias.');
        const importId=randomUUID(),prepared=[];
        for(let i=0;i<input.rows.length;i++){
          const row=input.rows[i];if(!row||typeof row!=='object'||Array.isArray(row))bad('Revisa la fila '+(i+2)+'.');
          const article=await required('articles',row.articleId);if(!article.active)bad('El artículo '+article.name+' está desactivado.');
          const warehouse=await required('warehouses',row.warehouseId),supplier=await required('partners',row.partnerId);if(supplier.kind!=='Proveedor')bad('El proveedor de la fila '+(i+2)+' no es válido.');
          const expiry=row.expiry||null;if(expiry&&(!/^\d{4}-\d{2}-\d{2}$/.test(expiry)||!Number.isFinite(Date.parse(expiry))||new Date(expiry).toISOString().slice(0,10)!==expiry))bad('Caducidad inválida en la fila '+(i+2)+'.');
          prepared.push({id:randomUUID(),articleId:article.id,warehouseId:warehouse.id,partnerId:supplier.id,lot:text(row.lot,'lote de la fila '+(i+2),60),expiry,quantity:amount(row.quantity,article.unit),reserved:0,receivedAt:now(),reference:text(row.reference,'referencia de la fila '+(i+2),80),unitCost:cost(row.unitCost,'costo de la fila '+(i+2)),initialImportId:importId});
        }
        for(const batch of prepared){await save('batches',batch);await event(user,'Carga inicial',batch,batch.quantity,{reference:batch.reference,partnerId:batch.partnerId,initialImportId:importId});}
        result={id:importId,count:prepared.length};
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
        result={id:randomUUID(),articleId:article.id,warehouseId:input.warehouseId,partnerId:partner.id,lot,expiry,quantity:qty,reserved:0,receivedAt:now(),reference,unitCost:cost(input.unitCost),location:location(input.location)};
        if(input.purchaseId){const p=await required('purchases',input.purchaseId),items=purchaseItems(p),item=items.find(x=>x.articleId===article.id);if(!item||p.partnerId!==partner.id||item.received+qty>item.quantity)bad('La recepción no coincide con la orden o supera lo pendiente.',409);item.received+=qty;p.items=items;p.status=items.every(x=>x.received===x.quantity)?'Recibida':items.some(x=>x.received>0)?'Recepción parcial':'Emitida';if(items.length===1)Object.assign(p,{articleId:item.articleId,quantity:item.quantity,received:item.received});await save('purchases',p);result.purchaseId=p.id;}
        await save('batches',result);await event(user,'Entrada',result,qty,{reference,partnerId:partner.id});
      } else if(path==='/issues'&&method==='POST'){
        permitted(user,['almacen']);const article=await required('articles',input.articleId);const qty=amount(input.quantity,article.unit);await required('warehouses',input.warehouseId);
        const partner=await required('partners',input.partnerId);if(partner.kind==='Proveedor')bad('Selecciona un cliente o punto de venta.');
        const reference=text(input.reference,'referencia',80),allocations=await allocate(article.id,input.warehouseId,qty);
        for(const a of allocations){const b=await required('batches',a.batchId);b.quantity-=a.qty;await save('batches',b);await event(user,'Salida PEPS',b,a.qty,{reference,partnerId:partner.id});}result={allocations};
      } else if(path==='/transfers'&&method==='POST'){
        permitted(user,['almacen']);const article=await required('articles',input.articleId);if(!article.active)bad('Artículo desactivado.');
        const source=await required('warehouses',input.sourceWarehouseId),destination=await required('warehouses',input.destinationWarehouseId);
        if(source.id===destination.id)bad('El almacén de destino debe ser diferente al de origen.');
        const qty=amount(input.quantity,article.unit),reference=text(input.reference,'referencia de transferencia',80),allocations=await allocate(article.id,source.id,qty);
        for(const allocation of allocations){const b=await required('batches',allocation.batchId);b.reserved+=allocation.qty;await save('batches',b);}
        result={id:randomUUID(),articleId:article.id,sourceWarehouseId:source.id,destinationWarehouseId:destination.id,quantity:qty,reference,status:'Preparada',allocations,createdAt:now(),history:[{status:'Preparada',at:now(),actor:user.name}]};await save('transfers',result);
      } else if(/^\/transfers\/[^/]+$/.test(path)&&method==='PATCH'){
        permitted(user,['almacen']);const transfer=await required('transfers',path.split('/')[2]),action=input.action;
        if(action==='send'&&transfer.status==='Preparada'){
          for(const allocation of transfer.allocations){const b=await required('batches',allocation.batchId);if(!usable(b))bad('Un lote reservado caducó. Cancela la transferencia y crea otra.',409);b.quantity-=allocation.qty;b.reserved-=allocation.qty;await save('batches',b);await event(user,'Transferencia salida',b,allocation.qty,{reference:transfer.reference,transferId:transfer.id,destinationWarehouseId:transfer.destinationWarehouseId});}transfer.status='Enviada';
        }else if(action==='receive'&&transfer.status==='Enviada'){
          for(const allocation of transfer.allocations){const sourceBatch=await required('batches',allocation.batchId),target={id:randomUUID(),articleId:sourceBatch.articleId,warehouseId:transfer.destinationWarehouseId,partnerId:sourceBatch.partnerId,lot:sourceBatch.lot,expiry:sourceBatch.expiry||null,unitCost:sourceBatch.unitCost??null,quantity:allocation.qty,reserved:0,receivedAt:now(),reference:transfer.reference,transferId:transfer.id,transferredFromBatchId:sourceBatch.id};await save('batches',target);allocation.targetBatchId=target.id;await event(user,'Transferencia entrada',target,allocation.qty,{reference:transfer.reference,transferId:transfer.id,sourceWarehouseId:transfer.sourceWarehouseId});}transfer.status='Recibida';
        }else if(action==='reject'&&transfer.status==='Enviada'){
          for(const allocation of transfer.allocations){const b=await required('batches',allocation.batchId);b.quantity+=allocation.qty;await save('batches',b);await event(user,'Transferencia rechazada',b,allocation.qty,{reference:transfer.reference,transferId:transfer.id,destinationWarehouseId:transfer.destinationWarehouseId});}transfer.status='Rechazada';
        }else if(action==='cancel'&&transfer.status==='Preparada'){
          for(const allocation of transfer.allocations){const b=await required('batches',allocation.batchId);b.reserved-=allocation.qty;await save('batches',b);}transfer.status='Cancelada';
        }else bad('Transición de transferencia no permitida.',409);
        transfer.history.push({status:transfer.status,at:now(),actor:user.name});await save('transfers',transfer);result=transfer;
      } else if(/^\/batches\/[^/]+$/.test(path)&&method==='PATCH'){
        permitted(user,['almacen']);const b=await required('batches',path.split('/')[2]);b.location=location(input.location);await save('batches',b);result=b;
      } else if(path==='/count-sessions'&&method==='POST'){
        permitted(user,['almacen']);const warehouse=await required('warehouses',input.warehouseId);
        if(input.kind&&!['Insumo','Producto terminado','Mercancía'].includes(input.kind))bad('Tipo de artículo inválido.');
        const open=(await list('countsessions','warehouseId',warehouse.id)).find(c=>['Abierto','En revisión'].includes(c.status));
        if(open)bad('Ya hay un conteo abierto en este almacén ('+open.reference+'). Termínalo o cancélalo primero.',409);
        const articles=new Map((await list('articles')).map(a=>[a.id,a]));
        const lines=(await list('batches','warehouseId',warehouse.id)).filter(b=>(b.quantity>0||b.reserved>0)&&(!input.kind||articles.get(b.articleId)?.kind===input.kind))
          .sort((a,b)=>(a.location||'~').localeCompare(b.location||'~')||(articles.get(a.articleId)?.name||'').localeCompare(articles.get(b.articleId)?.name||'')||a.lot.localeCompare(b.lot))
          .map(b=>({batchId:b.id,articleId:b.articleId,lot:b.lot,location:b.location||'',expected:b.quantity,counted:null}));
        if(!lines.length)bad('No hay lotes con existencia para contar en ese almacén.');
        if(lines.length>200)bad('El conteo tendría '+lines.length+' lotes; el máximo es 200. Filtra por tipo de artículo.');
        result={id:randomUUID(),warehouseId:warehouse.id,kind:input.kind||'',blind:input.blind!==false&&input.blind!=='false',reference:text(input.reference,'referencia del conteo',80),status:'Abierto',lines,createdAt:now(),createdBy:user.id,createdByName:user.name,history:[{status:'Abierto',at:now(),actor:user.name}]};
        await save('countsessions',result);
      } else if(/^\/count-sessions\/[^/]+$/.test(path)&&method==='PATCH'){
        const c=await required('countsessions',path.split('/')[2]),action=input.action;
        if(action==='record'&&c.status==='Abierto'){
          permitted(user,['almacen']);if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>200)bad('Envía entre 1 y 200 renglones.');
          for(const row of input.lines){const line=c.lines.find(l=>l.batchId===row?.batchId);if(!line)bad('Un renglón no pertenece a este conteo.');const a=await required('articles',line.articleId);line.counted=row.counted===''||row.counted===null||row.counted===undefined?null:amount(row.counted,a.unit,true);line.countedBy=user.name;}
        }else if(action==='submit'&&c.status==='Abierto'){
          permitted(user,['almacen']);if(!c.lines.some(l=>l.counted!==null))bad('Captura al menos un renglón antes de enviar a revisión.');c.status='En revisión';
        }else if(action==='reopen'&&c.status==='En revisión'){
          permitted(user,[]);c.status='Abierto';
        }else if(action==='approve'&&c.status==='En revisión'){
          permitted(user,[]);let adjusted=0;
          for(const line of c.lines){
            if(line.counted===null)continue;const difference=line.counted-line.expected;if(!difference)continue;
            // Apply the difference on top of movements made while the count was open.
            const b=await required('batches',line.batchId),previous=b.quantity,next=previous+difference;
            if(next<b.reserved||next<0)bad('El lote '+b.lot+' quedaría por debajo de lo reservado. Reabre el conteo y revísalo.',409);
            b.quantity=next;await save('batches',b);adjusted++;
            await event(user,difference>0?'Ajuste positivo':'Ajuste negativo',b,Math.abs(difference),{reference:c.reference,reason:'Conteo cíclico aprobado',previousQuantity:previous,countedQuantity:next,difference,countSessionId:c.id});
          }
          c.status='Aprobado';c.adjusted=adjusted;
        }else if(action==='cancel'&&['Abierto','En revisión'].includes(c.status)){
          permitted(user,['almacen']);c.status='Cancelado';
        }else bad('Acción de conteo no permitida.',409);
        if(action!=='record')c.history.push({status:c.status,at:now(),actor:user.name});
        await save('countsessions',c);result=c;
      } else if(path==='/waste'&&method==='POST'){
        permitted(user,['almacen']);const b=await required('batches',input.batchId),article=await required('articles',b.articleId),qty=amount(input.quantity,article.unit);
        if(qty>b.quantity-b.reserved)bad('La merma supera la cantidad no reservada.',409);
        const reason=text(input.reason,'causa de merma',200);b.quantity-=qty;await save('batches',b);result=await event(user,'Merma',b,qty,{reference:reason});
      } else if(path==='/counts'&&method==='POST'){
        permitted(user,['almacen']);const b=await required('batches',input.batchId),article=await required('articles',b.articleId);
        const counted=amount(input.countedQuantity,article.unit,true),previous=b.quantity;
        if(counted<b.reserved)bad('El conteo no puede quedar por debajo de la cantidad reservada.',409);
        const reason=text(input.reason,'motivo del conteo',120),reference=text(input.reference,'referencia del conteo',80),difference=counted-previous;
        b.quantity=counted;await save('batches',b);
        result=await event(user,difference>0?'Ajuste positivo':difference<0?'Ajuste negativo':'Conteo sin diferencia',b,Math.abs(difference),{reference,reason,previousQuantity:previous,countedQuantity:counted,difference});
      } else if(path==='/returns/customer'&&method==='POST'){
        permitted(user,['almacen']);const source=await required('batches',input.batchId),article=await required('articles',source.articleId),warehouse=await required('warehouses',input.warehouseId),customer=await required('partners',input.partnerId);
        if(customer.kind==='Proveedor')bad('Selecciona un cliente o punto de venta.');
        const qty=amount(input.quantity,article.unit),reason=text(input.reason,'motivo de devolución',160),reference=text(input.reference,'referencia de devolución',80);
        const outbound=(await list('events','batchId',source.id)).filter(e=>['Salida PEPS','Despacho','Despacho parcial'].includes(e.type)).reduce((n,e)=>n+e.qty,0);
        const returned=(await list('events','sourceBatchId',source.id)).filter(e=>e.type==='Devolución de cliente').reduce((n,e)=>n+e.qty,0);
        if(qty>outbound-returned)bad('La devolución supera la cantidad despachada pendiente de retorno para ese lote.',409);
        const target={id:randomUUID(),articleId:source.articleId,warehouseId:warehouse.id,partnerId:source.partnerId,lot:source.lot,expiry:source.expiry||null,unitCost:source.unitCost??null,quantity:qty,reserved:0,receivedAt:now(),reference,returnedFromBatchId:source.id,returnedFromPartnerId:customer.id};
        await save('batches',target);result=await event(user,'Devolución de cliente',target,qty,{reference,reason,partnerId:customer.id,sourceBatchId:source.id});
      } else if(path==='/returns/supplier'&&method==='POST'){
        permitted(user,['almacen']);const b=await required('batches',input.batchId),article=await required('articles',b.articleId),supplier=await required('partners',input.partnerId);
        if(supplier.kind!=='Proveedor')bad('Selecciona un proveedor.');
        const qty=amount(input.quantity,article.unit);if(qty>b.quantity-b.reserved)bad('La devolución supera la cantidad no reservada del lote.',409);
        const reason=text(input.reason,'motivo de devolución',160),reference=text(input.reference,'referencia de devolución',80);b.quantity-=qty;await save('batches',b);
        result=await event(user,'Devolución a proveedor',b,qty,{reference,reason,partnerId:supplier.id});
      } else if(path==='/purchases'&&method==='POST'){
        permitted(user,['compras']);const p=await required('partners',input.partnerId);if(p.kind!=='Proveedor')bad('Selecciona un proveedor.');
        const requested=Array.isArray(input.items)?input.items:[{articleId:input.articleId,quantity:input.quantity}];if(!requested.length||requested.length>20)bad('La compra debe contener entre 1 y 20 artículos.');
        const seen=new Set(),items=[];for(let i=0;i<requested.length;i++){const row=requested[i];if(!row||typeof row!=='object')bad('Revisa el artículo '+(i+1)+'.');const a=await required('articles',row.articleId);if(!a.active)bad('El artículo '+a.name+' está desactivado.');if(seen.has(a.id))bad('Cada artículo debe aparecer una sola vez.',409);seen.add(a.id);items.push({articleId:a.id,quantity:amount(row.quantity,a.unit),received:0});}
        result={id:randomUUID(),partnerId:p.id,items,status:'Emitida',reference:text(input.reference,'referencia',80),createdAt:now()};if(items.length===1)Object.assign(result,{articleId:items[0].articleId,quantity:items[0].quantity,received:0});await save('purchases',result);
      } else if(path==='/requests'&&method==='POST'){
        permitted(user,['solicitante','compras','almacen']);await required('warehouses',input.warehouseId);
        const requested=Array.isArray(input.items)?input.items:[{articleId:input.articleId,quantity:input.quantity}];
        if(!requested.length||requested.length>20)bad('La solicitud debe contener entre 1 y 20 artículos.');
        const seen=new Set(),items=[];
        for(let i=0;i<requested.length;i++){
          const row=requested[i];if(!row||typeof row!=='object')bad('Revisa el artículo '+(i+1)+'.');
          const a=await required('articles',row.articleId);if(!a.active)bad('El artículo '+a.name+' está desactivado.');if(seen.has(a.id))bad('Cada artículo debe aparecer una sola vez.',409);seen.add(a.id);
          items.push({articleId:a.id,quantity:amount(row.quantity,a.unit),allocations:[]});
        }
        result={id:randomUUID(),warehouseId:input.warehouseId,items,destination:text(input.destination,'empresa / punto de venta destinatario'),reference:text(input.reference,'referencia de la solicitud',80),createdBy:user.id,createdByName:user.name,createdAt:now(),status:'Pendiente',history:[{status:'Pendiente',at:now(),actor:user.name}]};
        if(items.length===1)Object.assign(result,{articleId:items[0].articleId,quantity:items[0].quantity,allocations:items[0].allocations});await save('requests',result);
      } else if(/^\/requests\/[^/]+$/.test(path)&&method==='PATCH'){
        const r=await required('requests',path.split('/')[2]),action=input.action,items=requestItems(r);r.items=items;
        if(action==='receive'){if(user.role!=='administrador'&&r.createdBy!==user.id)bad('Solo el solicitante o el administrador puede confirmar la recepción.',403);if(r.status!=='Despachada')bad('Primero debe despacharse toda la solicitud.',409);r.status='Recibida';}
        else{
          permitted(user,['almacen']);
          if(action==='approve'&&r.status==='Pendiente'){
            for(const item of items)item.allocations=(await allocate(item.articleId,r.warehouseId,item.quantity)).map(a=>({...a,dispatched:0}));
            for(const item of items)for(const allocation of item.allocations){const b=await required('batches',allocation.batchId);b.reserved+=allocation.qty;await save('batches',b);}r.status='Aprobada';
          }else if(action==='dispatch'&&['Aprobada','Parcialmente despachada'].includes(r.status)){
            const deliveries=Array.isArray(input.items)?input.items:items.map(item=>({articleId:item.articleId,quantity:(item.quantity-item.allocations.reduce((n,a)=>n+(a.dispatched||0),0))/1000}));
            const delivered=new Map();let total=0;
            for(const row of deliveries){if(!row||typeof row!=='object'||!items.some(item=>item.articleId===row.articleId)||delivered.has(row.articleId))bad('Revisa los artículos del despacho.');const article=await required('articles',row.articleId),qty=amount(row.quantity,article.unit,true);delivered.set(row.articleId,qty);total+=qty;}
            if(!total)bad('Indica al menos una cantidad para despachar.');
            for(const item of items){let left=delivered.get(item.articleId)||0,remaining=item.quantity-item.allocations.reduce((n,a)=>n+(a.dispatched||0),0);if(left>remaining)bad('El despacho supera la cantidad pendiente.',409);
              for(const allocation of item.allocations){if(!left)break;const available=allocation.qty-(allocation.dispatched||0),qty=Math.min(left,available);if(!qty)continue;const b=await required('batches',allocation.batchId);if(!usable(b))bad('Un lote reservado caducó. Cancela la solicitud y crea otra.',409);b.quantity-=qty;b.reserved-=qty;allocation.dispatched=(allocation.dispatched||0)+qty;left-=qty;await save('batches',b);await event(user,'Despacho parcial',b,qty,{requestId:r.id,destination:r.destination,reference:r.reference});}
            }
            r.status=items.every(item=>item.allocations.reduce((n,a)=>n+(a.dispatched||0),0)===item.quantity)?'Despachada':'Parcialmente despachada';
          }else if(action==='cancel'&&['Pendiente','Aprobada','Parcialmente despachada'].includes(r.status)){
            for(const item of items)for(const allocation of item.allocations){const pending=allocation.qty-(allocation.dispatched||0);if(pending){const b=await required('batches',allocation.batchId);b.reserved-=pending;await save('batches',b);}}r.status='Cancelada';
          }else bad('Transición no permitida.',409);
        }
        if(items.length===1)Object.assign(r,{articleId:items[0].articleId,quantity:items[0].quantity,allocations:items[0].allocations});
        r.history.push({status:r.status,at:now(),actor:user.name});await save('requests',r);result=r;
        if(action==='receive')for(const item of items)for(const allocation of item.allocations){const qty=allocation.dispatched||0;if(qty){const b=await required('batches',allocation.batchId);await event(user,'Entrega confirmada',b,qty,{requestId:r.id,destination:r.destination,reference:r.reference});}}
      }else bad('Operación no encontrada.',404);
      await db.saveAudit({id:randomUUID(),actor_id:user.id,target_id:result.id||null,action:'inventory'+path,created_at:now(),details:{method,action:typeof input.action==='string'?input.action:null,reference:result.reference||input.reference||null,name:typeof result.name==='string'&&path!=='/company'?result.name:null,count:result.count||null}});
      await save('settings',{id:'revision',at:now()+'#'+randomUUID().slice(0,8)});
      if(key)await save('commands',{id:key,fingerprint,result,createdAt:now()});
      return result;
    });
  }
  return {handle};
}
module.exports={operations,amount};
