const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createApp}=require('../server.cjs');
const A=require('../lib/auth.cjs');
const {amount}=require('../lib/operations.cjs');
async function setup(t){
  const database=process.env.FIRESTORE_EMULATOR_HOST?{projectId:'demo-nexo',namespace:'ops_test_'+randomUUID().replaceAll('-','')}:{memory:true};
  const app=createApp({database,googleClientId:'',googleClientSecret:''});await app.ready;
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>app.server.close(r));await app.closed;});
  const users={};
  for(const role of ['administrador','almacen','solicitante','consulta']){const u=await app.db.createUser({id:randomUUID(),email:role+'@example.test',name:role,role,status:'active',created_at:new Date().toISOString()});users[role]={...u,cookie:'nexo_session='+await A.createSession(app.db,u.id)};}
  async function req(path,method='GET',body,role='administrador',origin='http://127.0.0.1:4173'){
    const res=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/v1/operations'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(users[role]?{Cookie:users[role].cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};
  }
  async function post(path,body){const r=await req(path,'POST',body);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  const w=await post('/warehouses',{name:'Central',location:'Querétaro'}),supplier=await post('/partners',{name:'Proveedor A',kind:'Proveedor',reference:'QRO'}),customer=await post('/partners',{name:'Sucursal A',kind:'Punto de venta',reference:'SJR'}),a=await post('/articles',{sku:'ART-01',name:'Tornillo',kind:'Mercancía',unit:'pzas'});
  const receipt=(lot,quantity)=>post('/receipts',{articleId:a.id,warehouseId:w.id,partnerId:supplier.id,lot,quantity,reference:'REC-'+lot});
  return {...app,req,post,users,w,supplier,customer,a,receipt};
}
test('unit precision rejects fractional pieces, exponent notation, and unsafe quantities',()=>{
  assert.equal(amount('12','pzas'),12000);assert.equal(amount('0.125','kg'),125);
  for(const v of ['0.0002','-1','NaN','1e3','1000000000001'])assert.throws(()=>amount(v,'kg'));
  assert.throws(()=>amount('0.5','pzas'));assert.equal(amount('0','pzas',true),0);
});
test('FIFO consumes oldest receipts across lots and records recipients without negative stock',async t=>{
  const {req,db,a,w,customer,receipt}=await setup(t);
  const first=await receipt('FIRST',5),second=await receipt('SECOND',8);
  await db.operationSave('batches',first.id,{...first,receivedAt:'2026-01-01T00:00:00.000Z'});
  const body={articleId:a.id,warehouseId:w.id,partnerId:customer.id,quantity:7,reference:'DES-1'};
  const out=await req('/issues','POST',body);assert.equal(out.status,200);
  assert.deepEqual(out.data.allocations,[{batchId:first.id,qty:5000},{batchId:second.id,qty:2000}]);
  const attempts=await Promise.all([req('/issues','POST',{...body,quantity:5}),req('/issues','POST',{...body,quantity:5})]);
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
  const s=(await req('/snapshot')).data;
  assert.ok(s.batches.every(b=>b.quantity>=0));assert.equal(s.batches.reduce((n,b)=>n+b.quantity,0),1000);
  assert.ok(s.events.filter(e=>e.type==='Salida PEPS').every(e=>e.partnerId===customer.id));
});
test('request reservations, scoped visibility, dispatch and confirmation enforce lifecycle',async t=>{
  const {req,a,w,receipt,customer}=await setup(t);await receipt('L1',10);
  const r=await req('/requests','POST',{articleId:a.id,warehouseId:w.id,quantity:7,destination:'Sucursal Norte',reference:'SOL-1'},'solicitante');assert.equal(r.status,200);
  const path='/requests/'+r.data.id;
  assert.equal((await req(path,'PATCH',{action:'approve'},'solicitante')).status,403);
  assert.equal((await req(path,'PATCH',{action:'approve'},'almacen')).status,200);
  assert.equal((await req('/issues','POST',{articleId:a.id,warehouseId:w.id,partnerId:customer.id,quantity:4,reference:'DENY'})).status,409);
  assert.equal((await req(path,'PATCH',{action:'receive'},'solicitante')).status,409);
  assert.equal((await req(path,'PATCH',{action:'dispatch'},'almacen')).status,200);
  assert.equal((await req(path,'PATCH',{action:'dispatch'},'almacen')).status,409);
  assert.equal((await req(path,'PATCH',{action:'receive'},'consulta')).status,403);
  assert.equal((await req(path,'PATCH',{action:'receive'},'solicitante')).status,200);
  await req('/requests','POST',{articleId:a.id,warehouseId:w.id,quantity:1,destination:'Otra',reference:'PRIVATE'});
  const visible=(await req('/snapshot','GET',undefined,'solicitante')).data;
  assert.equal(visible.requests.length,1);assert.equal(visible.events.length,0);assert.equal(visible.batches.length,0);assert.equal(visible.partners.length,0);
  const full=(await req('/snapshot')).data;assert.equal(full.batches[0].quantity,3000);assert.equal(full.batches[0].reserved,0);
  assert.equal(full.events.filter(e=>e.type==='Entrega confirmada').length,1);
});
test('expired lots are excluded, cancellation releases reservations and waste respects them',async t=>{
  const {req,db,a,w,receipt}=await setup(t);const old=await receipt('OLD',10);await db.operationSave('batches',old.id,{...old,expiry:'2000-01-01'});const fresh=await receipt('NEW',5);
  const r=(await req('/requests','POST',{articleId:a.id,warehouseId:w.id,quantity:5,destination:'Cliente',reference:'SOL'})).data;
  assert.equal((await req('/requests/'+r.id,'PATCH',{action:'approve'})).status,200);
  assert.equal((await req('/waste','POST',{batchId:fresh.id,quantity:1,reason:'Daño'})).status,409);
  assert.equal((await req('/requests/'+r.id,'PATCH',{action:'cancel'})).status,200);
  assert.equal((await req('/waste','POST',{batchId:fresh.id,quantity:1,reason:'Daño'})).status,200);
  const s=(await req('/snapshot')).data;assert.equal(s.batches.find(b=>b.id===old.id).quantity,10000);assert.equal(s.batches.find(b=>b.id===fresh.id).reserved,0);
});
test('catalog, minimums, company and purchases validate input and role permissions',async t=>{
  const {req,post,a,w,supplier}=await setup(t);
  assert.equal((await req('/snapshot','GET',undefined,'anonymous')).status,401);
  assert.equal((await req('/articles','POST',{sku:'NO'},'consulta')).status,403);
  assert.equal((await req('/articles','POST',{sku:a.sku,name:'Duplicate',unit:'pzas',kind:'Mercancía'})).status,409);
  assert.equal((await req('/company','PATCH',{name:'Cliente real',logo:''},'almacen')).status,403);
  assert.equal((await req('/company','PATCH',{name:'Cliente real',logo:'data:image/svg+xml;base64,PHN2Zz4='})).status,400);
  assert.equal((await req('/company','PATCH',{name:'Cliente real',logo:''})).status,200);
  assert.equal((await req('/policies','POST',{articleId:a.id,warehouseId:w.id,minimum:'0.2'})).status,400);
  await post('/policies',{articleId:a.id,warehouseId:w.id,minimum:'5'});
  const p=await post('/purchases',{articleId:a.id,partnerId:supplier.id,quantity:10,reference:'OC1'});
  const body={articleId:a.id,partnerId:supplier.id,warehouseId:w.id,quantity:6,lot:'L',reference:'REC',purchaseId:p.id};
  assert.equal((await req('/receipts','POST',{...body,quantity:'0.0002'})).status,400);
  await post('/receipts',body);
  assert.equal((await req('/receipts','POST',body)).status,409);
  await post('/receipts',{...body,quantity:4});
  const s=(await req('/snapshot')).data;assert.equal(s.company.name,'Cliente real');assert.equal(s.policies[0].minimum,5000);assert.equal(s.purchases[0].status,'Recibida');
  assert.equal((await req('/company','PATCH',{name:'X'},'administrador','https://evil.example')).status,403);
});
test('retrying a receipt with the same operation ID records stock only once',async t=>{
  const {req,a,w,supplier}=await setup(t);
  const body={_operationId:randomUUID(),articleId:a.id,warehouseId:w.id,partnerId:supplier.id,quantity:3,lot:'IDEMPOTENT',reference:'REC'};
  const result=await Promise.all([req('/receipts','POST',body),req('/receipts','POST',body)]);
  assert.ok(result.every(r=>r.status===200));assert.equal(result[0].data.id,result[1].data.id);
  assert.equal((await req('/receipts','POST',{...body,quantity:4})).status,409);
  const s=(await req('/snapshot')).data;assert.equal(s.batches.length,1);assert.equal(s.events.length,1);assert.equal(s.batches[0].quantity,3000);
});
