const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function maintenanceKind(r){const kind=s=>/\binstalacion\b|\binstalar\b/.test(s)?'Instalación':/\bmantenimient\w*|\blimpieza\b/.test(s)?'Mantenimiento':'';return kind(norm([r.invoiceType,r.type,r.serviceType].join(' ')))||kind(norm([r.title,r.serviceTitle,...(r.items||[]).map(i=>i.description)].join(' ')));}
export function addMonthsClamped(date,months=6){const [y,m,d]=String(date).split('-').map(Number);const t=new Date(Date.UTC(y,m-1+months,1,12));if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(t.getTime()))throw Error('Fecha inválida');t.setUTCDate(Math.min(d,new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,0)).getUTCDate()));return t.toISOString().slice(0,10);}
export const maintenanceDate=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Puerto_Rico',year:'numeric',month:'2-digit',day:'2-digit'});
const closed=f=>['Completado','Cancelado','Cancelada'].includes(f.status);
const done=s=>['Completado','Completada','Facturado'].includes(s.status);
const stamp=()=>new Date().toISOString();
export function maintenanceReminder(records,source,id,r,day){
 if(!r.clientId||!records.clients[r.clientId]||!maintenanceKind(r)||['Borrador','Cancelada','Cancelado'].includes(r.status)||(source==='service'&&!done(r)))return false;
 const sid=source==='service'?id:r.serviceId||'',s=sid?records.services[sid]:null;
 if(sid&&(!s||s.clientId!==r.clientId))throw Error('Trabajo vinculado inválido');
 if(s&&['Cancelado','Cancelada'].includes(s.status))return false;
 const key=sid?'maint-service-'+sid:'maint-invoice-'+id;
 const hit=Object.entries(records.followups).find(([k,f])=>k===key||(sid&&((f.sourceType==='service'&&f.sourceId===sid)||f.serviceId===sid))||(source==='invoice'&&f.sourceType==='invoice-mobile'&&f.sourceId===id));
 const old=hit?.[1];if(old&&closed(old))return false;
 const date=String(s?.completedAt||r.completedAt||r.date||day).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const dueDate=addMonthsClamped(date),client=records.clients[r.clientId],invoiceId=source==='invoice'?id:old?.invoiceId||'';
 if(old?.autoMaintenance&&old.lastServiceDate===date&&old.clientId===r.clientId&&old.invoiceId===invoiceId)return false;
 records.followups[hit?.[0]||key]={...old,clientId:r.clientId,clientName:client.name||r.clientName||'',clientPhone:client.phone||client.whatsapp||'',assetId:r.assetId||s?.assetId||'',assetName:r.assetName||s?.assetName||'',type:'Mantenimiento',title:'Mantenimiento preventivo · 6 meses',date:dueDate,dueDate,nextDate:dueDate,intervalMonths:6,status:'Programado',priority:old?.priority||'Normal',channel:'WhatsApp',sourceType:sid?'service':'invoice-mobile',sourceId:sid||id,serviceId:sid,invoiceId,autoMaintenance:true,maintenanceOrigin:maintenanceKind(s||r)||maintenanceKind(r),lastServiceDate:date,createdAt:old?.createdAt||stamp(),updatedAt:stamp()};
 return true;
}
export function completeMaintenance(records,id,day){const f=records.followups[id];if(!f||closed(f))return false;f.status='Completado';f.completedAt=day;f.updatedAt=stamp();if(!/manten/.test(norm(f.type)))return true;const months=Math.max(1,Math.min(120,Math.trunc(Number(f.intervalMonths)||6))),dueDate=addMonthsClamped(day,months);if(!Object.values(records.followups).some(v=>v.sourceType==='recurring-mobile'&&v.sourceId===id)){records.followups[crypto.randomUUID()]={clientId:f.clientId,clientName:f.clientName||'',clientPhone:f.clientPhone||'',assetId:f.assetId||'',assetName:f.assetName||'',type:'Mantenimiento',title:'Mantenimiento preventivo · '+months+' meses',date:dueDate,dueDate,nextDate:dueDate,intervalMonths:months,status:'Programado',priority:f.priority||'Normal',channel:'WhatsApp',sourceType:'recurring-mobile',sourceId:id,autoMaintenance:true,maintenanceOrigin:'Mantenimiento',lastServiceDate:day,createdAt:stamp(),updatedAt:stamp()};}return true;}
export function maintenanceMessage(f,name,business){const date=String(f.lastServiceDate||'').slice(0,10),last=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+'T12:00:00').toLocaleDateString('es-PR',{month:'long',year:'numeric'}) : '';return 'Hola'+(name?', '+name:'')+'. Te saludamos de '+(business||'nuestro negocio')+'. '+(last?'Según nuestro registro, realizamos '+(f.maintenanceOrigin==='Instalación'?'la instalación':'el mantenimiento')+' de tu aire acondicionado en '+last+'. ':'')+'Se acerca tu mantenimiento preventivo'+(f.assetName?' de '+f.assetName:'')+'. ¿Cómo está funcionando tu equipo? Podemos ayudarte a coordinar una fecha. ¡Quedamos a tu disposición!';}
