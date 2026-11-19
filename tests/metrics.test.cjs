const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createApp}=require('../server.cjs');
const A=require('../lib/auth.cjs');
const {compute}=require('../lib/metrics.cjs');

const article={id:'a1',sku:'ART-01',name:'Tornillo',unit:'pzas',active:true};
const ev=(type,qty,at,batchId='b1')=>({id:randomUUID(),type,batchId,articleId:'a1',warehouseId:'w1',qty,at});

test('rewinds stock month by month to value inventory, waste and rotation',()=>{
  // Current stock 60 pzas at $10. Sep: +100 received; Oct: −30 issued, −10 waste; Nov: no change.
  const batches=[{id:'b1',articleId:'a1',warehouseId:'w1',quantity:60000,reserved:0,unitCost:1000}];
  const events=[ev('Entrada',100000,'2026-09-10T18:00:00.000Z'),ev('Salida PEPS',30000,'2026-10-05T18:00:00.000Z'),ev('Merma',10000,'2026-10-20T18:00:00.000Z'),ev('Entrega confirmada',30000,'2026-10-06T18:00:00.000Z')];
  const m=compute({articles:[article],batches,events,months:3,now:'2026-11-18T18:00:00.000Z'});
  assert.deepEqual(m.monthly.map(x=>x.month),['2026-09','2026-10','2026-11']);
  assert.deepEqual(m.monthly.map(x=>x.closingValue),[1000,600,600]);
  assert.equal(m.monthly[0].openingValue,0);
  assert.deepEqual(m.monthly.map(x=>x.movements.total),[1,2,0]);
  assert.equal(m.monthly[1].wasteValue,100);assert.equal(m.monthly[1].exitValue,300);
  assert.equal(m.monthly[1].rotation,0.38); // 300 / ((1000+600)/2)
  assert.equal(m.inventoryValue,600);assert.deepEqual(m.costCoverage,{valued:1,total:1});
  const row=m.articles[0];
  assert.equal(row.exits,30000);assert.equal(row.waste,10000);
  assert.equal(row.averageStock,55000); // opening 0, closes 100, 60, 60
  assert.equal(row.rotation,0.55);assert.equal(row.stockValue,600);
});

test('event months follow Mexico City time and transfers do not count as consumption',()=>{
  const batches=[{id:'b1',articleId:'a1',warehouseId:'w1',quantity:5000,reserved:0},{id:'b2',articleId:'a1',warehouseId:'w2',quantity:5000,reserved:0}];
  // 2026-11-01T03:00Z is still October 31 in Mexico City.
  const events=[ev('Entrada',10000,'2026-11-01T03:00:00.000Z'),ev('Transferencia salida',5000,'2026-11-02T18:00:00.000Z'),ev('Transferencia entrada',5000,'2026-11-03T18:00:00.000Z','b2')];
  const m=compute({articles:[article],batches,events,months:3,now:'2026-11-18T18:00:00.000Z'});
  assert.equal(m.monthly[1].movements.entries,1);assert.equal(m.monthly[2].movements.transfers,1);
  assert.equal(m.articles[0].exits,0);assert.equal(m.articles[0].rotation,0);
  assert.equal(m.costCoverage.valued,0);assert.equal(m.monthly[2].rotation,null);
  assert.equal(compute({articles:[],batches:[],events:[],months:99}).months,6);
});

test('metrics endpoint values receipts at cost and hides indicators from requesters',async t=>{
  const app=createApp({database:{memory:true},googleClientId:'',googleClientSecret:''});await app.ready;
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>app.server.close(r));await app.closed;});
  const cookies={};
  for(const role of ['administrador','solicitante']){const u=await app.db.createUser({id:randomUUID(),email:role+'@example.test',name:role,role,status:'active',created_at:new Date().toISOString()});cookies[role]='nexo_session='+await A.createSession(app.db,u.id);}
  const req=async(path,method='GET',body,role='administrador')=>{const res=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/v1/operations'+path,{method,headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:4173',Cookie:cookies[role]},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};};
  const post=async(path,body)=>{const r=await req(path,'POST',body);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
  const w=await post('/warehouses',{name:'Central',location:'Querétaro'}),s=await post('/partners',{name:'Proveedor A',kind:'Proveedor',reference:'QRO'}),c=await post('/partners',{name:'Sucursal',kind:'Punto de venta',reference:'SJR'}),a=await post('/articles',{sku:'ART-01',name:'Tornillo',kind:'Mercancía',unit:'pzas'});
  const base={articleId:a.id,warehouseId:w.id,partnerId:s.id,quantity:10,reference:'REC-1'};
  assert.equal((await req('/receipts','POST',{...base,lot:'X',unitCost:'12.345'})).status,400);
  const batch=await post('/receipts',{...base,lot:'L1',unitCost:'12.50'});assert.equal(batch.unitCost,1250);
  await post('/issues',{articleId:a.id,warehouseId:w.id,partnerId:c.id,quantity:4,reference:'SAL-1'});
  assert.equal((await post('/receipts',{...base,lot:'L2'})).unitCost,null);
  const m=await req('/metrics/3');assert.equal(m.status,200);
  assert.equal(m.data.months,3);assert.equal(m.data.inventoryValue,75);assert.deepEqual(m.data.costCoverage,{valued:1,total:2});
  assert.equal(m.data.monthly.at(-1).movements.entries,2);assert.equal(m.data.monthly.at(-1).exitValue,50);
  assert.equal((await req('/metrics')).data.months,6);
  assert.equal((await req('/metrics','GET',undefined,'solicitante')).status,403);
});
