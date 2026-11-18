const KEY='nexus-mobile-local-v1';
const collections=['clients','services','quotes','followups','invoices','payments','assets','contracts'];
const empty=()=>({schema:1,profile:null,records:Object.fromEntries(collections.map(c=>[c,{}])),sequences:{}});
let opening;const listeners=new Map();
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(KEY):null;
function database(){return opening??=new Promise((resolve,reject)=>{const r=indexedDB.open(KEY,1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function transact(write,fn){const d=await database();return new Promise((resolve,reject)=>{const t=d.transaction('data',write?'readwrite':'readonly'),s=t.objectStore('data'),r=s.get('workspace');let result,err;r.onsuccess=()=>{try{const v=r.result||empty();result=fn(v);if(write)s.put(v,'workspace');}catch(e){err=e;t.abort();}};t.oncomplete=()=>resolve(result);t.onabort=()=>reject(err||t.error||new Error('Operación cancelada'));t.onerror=()=>reject(t.error);});}
const clone=x=>structuredClone(x);
export const exportWorkspace=()=>transact(false,clone);
export const getProfile=()=>transact(false,v=>clone(v.profile));
export async function saveProfile(p){await transact(true,v=>{v.profile={...v.profile,...clone(p)};});}
export const serverTimestamp=()=>new Date().toISOString();
export const collection=(_db,_users,_uid,c)=>({c});
export const doc=(_db,_users,_uid,c,id)=>({c,id});
function check(c){if(!collections.includes(c))throw new Error('Colección no válida');}
function notify(c){for(const cb of listeners.get(c)||[])cb();channel?.postMessage(c);}
if(channel)channel.onmessage=e=>{for(const cb of listeners.get(e.data)||[])cb();};
export function onSnapshot(ref,success,error){check(ref.c);let active=true;const load=()=>transact(false,v=>Object.entries(v.records[ref.c]).map(([id,data])=>({id,data:()=>clone(data)}))).then(docs=>{if(active)success({docs});}).catch(e=>{if(active)error?.(e);});if(!listeners.has(ref.c))listeners.set(ref.c,new Set());listeners.get(ref.c).add(load);load();return()=>{active=false;listeners.get(ref.c)?.delete(load);};}
export async function addDoc(ref,data){check(ref.c);const id=crypto.randomUUID();await transact(true,v=>{v.records[ref.c][id]=clone(data);});notify(ref.c);return {id};}
export async function updateDoc(ref,data){check(ref.c);await transact(true,v=>{if(!Object.hasOwn(v.records[ref.c],ref.id))throw new Error('Registro no encontrado');v.records[ref.c][ref.id]={...v.records[ref.c][ref.id],...clone(data)};});notify(ref.c);}
export async function deleteDoc(ref){check(ref.c);await transact(true,v=>{delete v.records[ref.c][ref.id];});notify(ref.c);}
export async function nextInvoiceNumber(_db,_uid,_invoices,date){const year=String(date||new Date().toISOString()).slice(0,4);if(!/^\d{4}$/.test(year))throw new Error('Fecha inválida');return transact(true,v=>{const prefix='FAC-'+year+'-';const max=Object.values(v.records.invoices).reduce((m,x)=>String(x.number||'').startsWith(prefix)?Math.max(m,Number(x.number.slice(prefix.length))||0):m,0);const next=Math.max(max,v.sequences[year]||0)+1;v.sequences[year]=next;return prefix+String(next).padStart(4,'0');});}
function validate(b){if(!b||b.schema!==1||!b.profile||typeof b.profile.businessName!=='string'||!b.profile.businessName.trim()||!b.records||!b.sequences)throw new Error('Respaldo no válido');for(const c of collections){if(!b.records[c]||Array.isArray(b.records[c])||typeof b.records[c]!=='object')throw new Error('Colección inválida: '+c);for(const [id,r] of Object.entries(b.records[c]))if(!/^[\w-]{1,128}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||!r||typeof r!=='object'||Array.isArray(r))throw new Error('Registro inválido');}if(Object.entries(b.sequences).some(([k,n])=>!/^\d{4}$/.test(k)||!Number.isSafeInteger(n)||n<0))throw new Error('Secuencia inválida');if(!Number.isFinite(Number(b.profile.tax))||Number(b.profile.tax)<0||Number(b.profile.tax)>100)throw new Error('IVU inválido');for(const k of ['logo','logoPdf','logoDashboard'])if(b.profile[k]&&!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(b.profile[k]))throw new Error('Logo inválido');}
export async function restoreWorkspace(b){validate(b);await transact(true,v=>{v.profile=clone(b.profile);v.records=Object.fromEntries(collections.map(c=>[c,clone(b.records[c])]));v.sequences=clone(b.sequences);});for(const c of collections)notify(c);}
