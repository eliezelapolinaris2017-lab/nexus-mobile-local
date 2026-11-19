const KEY='nexus-mobile-local-v1';
const coreCollections=['clients','services','quotes','followups','invoices','payments','assets','contracts'];
const financeCollections=['expenses','suppliers','purchases','purchasePayments','inventory','stockUsage'];
const collections=[...coreCollections,...financeCollections];
const empty=()=>({schema:1,profile:null,records:Object.fromEntries(collections.map(c=>[c,{}])),sequences:{}});
let opening;const listeners=new Map();
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(KEY):null;
function database(){return opening??=new Promise((resolve,reject)=>{const r=indexedDB.open(KEY,1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function transact(write,fn,bump=true){const d=await database();return new Promise((resolve,reject)=>{const t=d.transaction('data',write?'readwrite':'readonly'),s=t.objectStore('data'),r=s.get('workspace');let result,err;r.onsuccess=()=>{try{const v=r.result||empty();for(const c of financeCollections)v.records[c]??={};result=fn(v);if(write){if(bump)v.localRevision=(v.localRevision||0)+1;s.put(v,'workspace');}}catch(e){err=e;t.abort();}};t.oncomplete=()=>{resolve(result);if(write&&bump){globalThis.dispatchEvent?.(new Event('nova-local-change'));channel?.postMessage('cloud-change');}};t.onabort=()=>reject(err||t.error||new Error('Operación cancelada'));t.onerror=()=>reject(t.error);});}
const clone=x=>structuredClone(x);
const snapshot=v=>clone({schema:v.schema,profile:v.profile,records:v.records,sequences:v.sequences});
export const exportWorkspace=()=>transact(false,snapshot);
export const cloudSnapshot=()=>transact(false,v=>({snapshot:snapshot(v),revision:v.localRevision||0,binding:clone(v.cloudBinding||null)}));
export async function acknowledgeCloud(owner,base,version,revision){
 await transact(true,v=>{
   const binding=v.cloudBinding;
   if(binding&&(binding.owner!==owner||binding.version!==base))throw Error('La conexión cambió mientras guardabas. Revisa el estado.');
   if(!binding&&base!==0)throw Error('No hay conexión local asociada.');
   if((v.localRevision||0)<revision)throw Error('Versión local inválida.');
   v.cloudBinding={owner,version,syncedRevision:revision};
 },false);
}
export async function applyCloudSnapshot(data,owner,version,revision){
 validate(data);
 await transact(true,v=>{
   if((v.localRevision||0)!==revision)throw Error('Hay cambios locales recientes. No se reemplazaron.');
   if(v.cloudBinding&&v.cloudBinding.owner!==owner)throw Error('Este dispositivo contiene otra cuenta de NOVA.');
   v.profile=clone(data.profile);v.records=Object.fromEntries(collections.map(c=>[c,clone(data.records[c]||{})]));v.sequences=clone(data.sequences);
   v.localRevision=(v.localRevision||0)+1;v.cloudBinding={owner,version,syncedRevision:v.localRevision};
 },false);
 for(const c of collections)notify(c);
}
export const getProfile=()=>transact(false,v=>clone(v.profile));
export async function saveProfile(p){await transact(true,v=>{v.profile={...v.profile,...clone(p)};});}
export const serverTimestamp=()=>new Date().toISOString();
export const collection=(_db,_users,_uid,c)=>({c});
export const doc=(_db,_users,_uid,c,id)=>({c,id});
function check(c){if(!collections.includes(c))throw new Error('Colección no válida');}
function notify(c){for(const cb of listeners.get(c)||[])cb();channel?.postMessage(c);}
if(channel)channel.onmessage=e=>{if(e.data==='cloud-change'){globalThis.dispatchEvent?.(new Event('nova-local-change'));return;}for(const cb of listeners.get(e.data)||[])cb();};
export function onSnapshot(ref,success,error){check(ref.c);let active=true;const load=()=>transact(false,v=>Object.entries(v.records[ref.c]).map(([id,data])=>({id,data:()=>clone(data)}))).then(docs=>{if(active)success({docs});}).catch(e=>{if(active)error?.(e);});if(!listeners.has(ref.c))listeners.set(ref.c,new Set());listeners.get(ref.c).add(load);load();return()=>{active=false;listeners.get(ref.c)?.delete(load);};}
export async function addDoc(ref,data){check(ref.c);const id=crypto.randomUUID();await transact(true,v=>{v.records[ref.c][id]=clone(data);});notify(ref.c);return {id};}
export async function updateDoc(ref,data){check(ref.c);await transact(true,v=>{if(!Object.hasOwn(v.records[ref.c],ref.id))throw new Error('Registro no encontrado');v.records[ref.c][ref.id]={...v.records[ref.c][ref.id],...clone(data)};});notify(ref.c);}
export async function deleteDoc(ref){check(ref.c);await transact(true,v=>{delete v.records[ref.c][ref.id];});notify(ref.c);}
export async function nextInvoiceNumber(_db,_uid,_invoices,date){const year=String(date||new Date().toISOString()).slice(0,4);if(!/^\d{4}$/.test(year))throw new Error('Fecha inválida');return transact(true,v=>{const prefix='FAC-'+year+'-';const max=Object.values(v.records.invoices).reduce((m,x)=>String(x.number||'').startsWith(prefix)?Math.max(m,Number(x.number.slice(prefix.length))||0):m,0);const next=Math.max(max,v.sequences[year]||0)+1;v.sequences[year]=next;return prefix+String(next).padStart(4,'0');});}
function validate(b){if(!b||b.schema!==1||!b.profile||typeof b.profile.businessName!=='string'||!b.profile.businessName.trim()||!b.records||!b.sequences)throw new Error('Respaldo no válido');for(const c of collections){if(financeCollections.includes(c)&&b.records[c]===undefined)continue;if(!b.records[c]||Array.isArray(b.records[c])||typeof b.records[c]!=='object')throw new Error('Colección inválida: '+c);for(const [id,r] of Object.entries(b.records[c]))if(!/^[\w-]{1,128}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||!r||typeof r!=='object'||Array.isArray(r))throw new Error('Registro inválido');}if(Object.entries(b.sequences).some(([k,n])=>!/^\d{4}$/.test(k)||!Number.isSafeInteger(n)||n<0))throw new Error('Secuencia inválida');if(!Number.isFinite(Number(b.profile.tax))||Number(b.profile.tax)<0||Number(b.profile.tax)>100)throw new Error('IVU inválido');for(const k of ['logo','logoPdf','logoDashboard'])if(b.profile[k]&&!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(b.profile[k]))throw new Error('Logo inválido');}
export async function restoreWorkspace(b){validate(b);await transact(true,v=>{v.profile=clone(b.profile);v.records=Object.fromEntries(collections.map(c=>[c,clone(b.records[c]===undefined&&financeCollections.includes(c)?v.records[c]:b.records[c]||{})]));v.sequences=clone(b.sequences);});for(const c of collections)notify(c);}

export async function createInvoiceWithPayment(invoice){
  const id=crypto.randomUUID();
  await transact(true,v=>{
    if(Object.values(v.records.invoices).some(i=>i.number===invoice.number))throw new Error('Número de factura repetido');
    v.records.invoices[id]=clone(invoice);
    if(invoice.status==='Pagada'&&Number(invoice.total)>0){
      const pid=crypto.randomUUID();
      v.records.payments[pid]={invoiceId:id,invoiceNumber:invoice.number,date:invoice.date,method:invoice.paymentMethod||'Móvil',amount:Number(invoice.total),createdAt:serverTimestamp(),note:'Pago registrado al crear factura móvil'};
    }
  });notify('invoices');notify('payments');return {id};
}
export async function settleInvoice(id,date,method){
  const amount=await transact(true,v=>{
    const inv=v.records.invoices[id];if(!inv||['Cancelada','Borrador'].includes(inv.status))throw new Error('Factura no disponible para cobro');
    const paid=Object.values(v.records.payments).filter(p=>p.invoiceId===id).reduce((sum,p)=>sum+Number(p.amount||0),0);
    const balance=Math.round((Number(inv.total||0)-paid)*100)/100;if(balance<=0)return 0;
    const pid=crypto.randomUUID();v.records.payments[pid]={invoiceId:id,invoiceNumber:inv.number,date,method,amount:balance,note:'Pago registrado desde Nexus Mobile Local',createdAt:serverTimestamp()};
    Object.assign(inv,{status:'Pagada',paymentMethod:method,updatedAt:serverTimestamp()});return balance;
  });notify('invoices');notify('payments');return amount;
}

const cents=v=>Math.round(Number(v)*100);
const validMoney=v=>Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=10000000&&Number.isSafeInteger(cents(v));
export async function savePurchase(p){
 const id=crypto.randomUUID();
 await transact(true,v=>{
  if(!v.records.suppliers[p.supplierId])throw Error('Selecciona un suplidor válido.');
  if(!validMoney(p.subtotal)||!validMoney(p.tax)||cents(p.subtotal)<=0||!validMoney(p.total)||cents(p.total)!==cents(p.subtotal)+cents(p.tax))throw Error('Importes de compra inválidos.');
  if(p.productId){
   const item=v.records.inventory[p.productId],qty=Number(p.qty);
   if(!item||!Number.isFinite(qty)||qty<=0||qty>1000000)throw Error('Producto o cantidad inválidos.');
   if(p.invoiceId)throw Error('Una compra de inventario no puede cargarse directamente a una factura.');
   const stock=Number(item.stock||0),cost=Number(item.avgCost||0);if(stock<0||!Number.isFinite(stock)||!validMoney(cost))throw Error('Inventario inválido.');
   item.avgCost=Math.round(((stock*cost+Number(p.total))/(stock+qty))*10000)/10000;item.stock=Math.round((stock+qty)*1000)/1000;
  }
  if(p.invoiceId&&!v.records.invoices[p.invoiceId])throw Error('Factura no encontrada.');
  v.records.purchases[id]=clone(p);
  if(p.paid){const pid=crypto.randomUUID();v.records.purchasePayments[pid]={purchaseId:id,date:p.date,amount:p.total,method:p.method||'Otro',createdAt:serverTimestamp()};}
 });for(const c of ['purchases','purchasePayments','inventory'])notify(c);return {id};
}
export async function payPurchase(id,amount,date,method){
 await transact(true,v=>{const p=v.records.purchases[id];if(!p)throw Error('Compra no encontrada.');const paid=Object.values(v.records.purchasePayments).filter(x=>x.purchaseId===id).reduce((a,x)=>a+cents(x.amount),0);const n=cents(amount);if(!validMoney(amount)||n<=0||n>cents(p.total)-paid)throw Error('El pago supera el balance o no es válido.');v.records.purchasePayments[crypto.randomUUID()]={purchaseId:id,amount:n/100,date,method,createdAt:serverTimestamp()};});notify('purchasePayments');
}
export async function useStock({productId,invoiceId,qty,date}){
 await transact(true,v=>{const item=v.records.inventory[productId],inv=v.records.invoices[invoiceId];qty=Number(qty);if(!item||!inv||['Cancelada','Borrador'].includes(inv.status)||!Number.isFinite(qty)||qty<=0||qty>Number(item.stock)||!validMoney(item.avgCost))throw Error('Factura, cantidad o existencia inválida.');
 const cost=cents(qty*Number(item.avgCost))/100;item.stock=Math.round((Number(item.stock)-qty)*1000)/1000;v.records.stockUsage[crypto.randomUUID()]={productId,invoiceId,qty,date,cost,productName:item.name,createdAt:serverTimestamp()};
 });notify('inventory');notify('stockUsage');
}
