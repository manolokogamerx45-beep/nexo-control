// Historical inventory indicators reconstructed from the event log.
// Quantities are stored in thousandths (see amount()) and costs in centavos.
const STOCK_SIGN={
  'Entrada':1,'Carga inicial':1,'Devolución de cliente':1,'Ajuste positivo':1,'Transferencia entrada':1,'Transferencia rechazada':1,
  'Salida PEPS':-1,'Despacho':-1,'Despacho parcial':-1,'Merma':-1,'Devolución a proveedor':-1,'Ajuste negativo':-1,'Transferencia salida':-1
};
const GROUP={
  'Entrada':'entries','Carga inicial':'entries','Devolución de cliente':'entries',
  'Salida PEPS':'exits','Despacho':'exits','Despacho parcial':'exits',
  'Merma':'waste','Devolución a proveedor':'supplierReturns',
  'Ajuste positivo':'adjustments','Ajuste negativo':'adjustments',
  'Transferencia salida':'transfers'
};
const PERIODS=[3,6,12];
const monthOf=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit'}).format(new Date(iso)).slice(0,7);
function lastMonths(count,now){
  const [y,m]=monthOf(now).split('-').map(Number),out=[];
  for(let i=count-1;i>=0;i--){const d=new Date(Date.UTC(y,m-1-i,1));out.push(d.toISOString().slice(0,7));}
  return out;
}
const daysIn=key=>{const [y,m]=key.split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate();};
const value=(qty,cost)=>cost==null?0:Math.round(qty*cost/1000);
const pesos=centavos=>centavos/100;
const ratio=(a,b)=>b>0?Math.round(a/b*100)/100:null;

function compute({articles,batches,events,months=6,now=new Date().toISOString()}){
  if(!PERIODS.includes(months))months=6;
  const keys=lastMonths(months,now),first=keys[0],current=keys.at(-1);
  const batchById=new Map(batches.map(b=>[b.id,b]));
  const stockEvents=events.filter(e=>STOCK_SIGN[e.type]&&batchById.has(e.batchId)).map(e=>({...e,month:monthOf(e.at)}));
  // Net signed change per batch after each month closes, to rewind current stock.
  const after=new Map();
  for(const e of stockEvents)for(const key of keys)if(e.month>key){const k=e.batchId+'|'+key;after.set(k,(after.get(k)||0)+STOCK_SIGN[e.type]*e.qty);}
  const opening=new Map();
  const beforeFirst=keys[0];
  for(const e of stockEvents)if(e.month>=beforeFirst)opening.set(e.batchId,(opening.get(e.batchId)||0)+STOCK_SIGN[e.type]*e.qty);
  const qtyAt=(b,key)=>key==null?b.quantity-(opening.get(b.id)||0):b.quantity-(after.get(b.id+'|'+key)||0);
  const closingValue=key=>batches.reduce((n,b)=>n+value(Math.max(0,qtyAt(b,key)),b.unitCost),0);

  const rows=keys.map(key=>({month:key,days:key===current?Number(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',day:'2-digit'}).format(new Date(now))):daysIn(key),entries:0,exits:0,waste:0,supplierReturns:0,adjustments:0,transfers:0,entryValue:0,exitValue:0,wasteValue:0}));
  const byMonth=new Map(rows.map(r=>[r.month,r]));
  const perArticle=new Map();
  for(const e of stockEvents){
    const row=byMonth.get(e.month),group=GROUP[e.type];if(!row||!group)continue;
    const cost=batchById.get(e.batchId).unitCost;
    row[group]++;
    if(group==='entries')row.entryValue+=value(e.qty,cost);
    if(group==='exits')row.exitValue+=value(e.qty,cost);
    if(group==='waste')row.wasteValue+=value(e.qty,cost);
    if(group==='exits'||group==='waste'){const a=perArticle.get(e.articleId)||{exits:0,waste:0,wasteValue:0};a[group]+=e.qty;if(group==='waste')a.wasteValue+=value(e.qty,cost);perArticle.set(e.articleId,a);}
  }
  let previous=closingValue(null);
  const monthly=rows.map(r=>{
    const close=closingValue(r.month),average=(previous+close)/2,result={
      month:r.month,
      movements:{entries:r.entries,exits:r.exits,waste:r.waste,supplierReturns:r.supplierReturns,adjustments:r.adjustments,transfers:r.transfers,total:r.entries+r.exits+r.waste+r.supplierReturns+r.adjustments+r.transfers},
      entryValue:pesos(r.entryValue),exitValue:pesos(r.exitValue),wasteValue:pesos(r.wasteValue),
      openingValue:pesos(previous),closingValue:pesos(close),
      rotation:ratio(r.exitValue,average)
    };previous=close;return result;
  });

  const periodDays=rows.reduce((n,r)=>n+r.days,0);
  const articleRows=articles.map(a=>{
    const own=batches.filter(b=>b.articleId===a.id),stock=own.reduce((n,b)=>n+b.quantity,0);
    // Average of the opening level and every month-end level in the period.
    const points=[null,...keys].map(key=>own.reduce((n,b)=>n+Math.max(0,qtyAt(b,key)),0));
    const averageStock=points.reduce((n,v)=>n+v,0)/points.length,moved=perArticle.get(a.id)||{exits:0,waste:0,wasteValue:0};
    const daily=moved.exits/periodDays,costed=own.filter(b=>b.unitCost!=null&&b.quantity>0);
    return {
      articleId:a.id,sku:a.sku,name:a.name,unit:a.unit,active:a.active,
      stock,exits:moved.exits,waste:moved.waste,wasteValue:pesos(moved.wasteValue),
      averageStock:Math.round(averageStock),
      rotation:ratio(moved.exits,averageStock),
      coverageDays:daily>0?Math.round(stock/daily):null,
      stockValue:pesos(own.reduce((n,b)=>n+value(b.quantity,b.unitCost),0)),
      valued:own.every(b=>b.quantity<=0||b.unitCost!=null)&&costed.length>0
    };
  }).filter(a=>a.active||a.stock>0||a.exits>0||a.waste>0).sort((a,b)=>(b.rotation??-1)-(a.rotation??-1)||a.sku.localeCompare(b.sku));

  const withStock=batches.filter(b=>b.quantity>0),totals=monthly.reduce((t,m)=>({exitValue:t.exitValue+m.exitValue,wasteValue:t.wasteValue+m.wasteValue,movements:t.movements+m.movements.total,waste:t.waste+m.movements.waste}),{exitValue:0,wasteValue:0,movements:0,waste:0});
  const avgValue=monthly.reduce((n,m)=>n+m.openingValue+m.closingValue,0)/(2*monthly.length);
  return {
    currency:'MXN',months,period:{from:first,to:current,days:periodDays},generatedAt:now,
    inventoryValue:pesos(closingValue(current)),
    costCoverage:{valued:withStock.filter(b=>b.unitCost!=null).length,total:withStock.length},
    totals:{movements:totals.movements,waste:totals.waste,exitValue:Math.round(totals.exitValue*100)/100,wasteValue:Math.round(totals.wasteValue*100)/100,rotation:ratio(totals.exitValue,avgValue)},
    monthly,articles:articleRows
  };
}
module.exports={compute,monthOf,STOCK_SIGN,PERIODS};
