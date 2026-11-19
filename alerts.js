// Derived from actual records, never sends customer messages on its own.
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T12:00:00Z'));
const dateOf=d=>typeof d==='string'&&validDate(d.slice(0,10))?d.slice(0,10):'';
const shift=(d,n)=>{const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
const done=s=>['Completado','Completada','Cancelado','Cancelada','Facturado'].includes(s.status||s.fields?.[3]||'');
export function deriveAlerts(state,{day,invoiceBalance,invoiceStatus,inactiveDays=180}){
 const tomorrow=shift(day,1),nextWeek=shift(day,7),cutoff=shift(day,-inactiveDays),rows=[];
 const clients=new Map(state.clients.map(c=>[c.id,c]));
 const owner=r=>clients.get(r.clientId)||{};
 const suppressed=(r,key)=>dateOf(r.novaAlertSnooze?.[key])>day;
 const add=(category,key,record,fields)=>{if(!record.id||suppressed(record,key))return;const client=owner(record);rows.push({category,key,id:record.id,clientId:record.clientId,clientName:client.name||record.clientName||'Cliente',phone:client.phone||client.whatsapp||'',...fields});};
 for(const s of state.services){
  const date=dateOf(s.date);if(done(s)||!date||date<day||date>tomorrow)continue;
  const pending=s.confirmationState!=='confirmed';
  add('agenda','appointment',s,{date,title:pending?'Cita por confirmar':'Cita próxima',detail:(s.title||'Servicio')+' · '+(s.time||'Por coordinar'),source:'services',time:s.time||'',service:s.title||'Servicio',pending,priority:date===day?0:1});
 }
 for(const inv of state.invoices){
  if(invoiceStatus(inv)!=='Vencida'||invoiceBalance(inv)<=0)continue;
  add('cobros','overdue',inv,{date:dateOf(inv.dueDate),title:'Factura vencida',detail:inv.number||'Factura',source:'invoices',balance:invoiceBalance(inv),number:inv.number||'',priority:0});
 }
 for(const follow of state.followups){
  const date=dateOf(follow.dueDate);
  if(done(follow)||!date||date>nextWeek)continue;
  add('seguimientos','followup',follow,{date,title:date<day?'Seguimiento vencido':'Seguimiento próximo',detail:follow.title||follow.type||'Seguimiento',source:'followups',priority:date<=day?0:1});
 }
 const last=new Map();
 const recordActivity=(id,date)=>{const d=dateOf(date);if(id&&d&&d<=day&&d>(last.get(id)||''))last.set(id,d);};
 // Only completed visits and non-draft, non-cancelled invoices establish actual history.
 for(const s of state.services)if(['Completado','Completada','Facturado'].includes(s.status))recordActivity(s.clientId,s.date);
 for(const i of state.invoices)if(!['Cancelada','Borrador'].includes(i.status)&&i.status)recordActivity(i.clientId,i.date);
 const activeScheduled=new Set(state.services.filter(s=>!done(s)&&dateOf(s.date)>=day).map(s=>s.clientId));
 for(const c of state.clients){
  if(c.novaNoMarketing===true||activeScheduled.has(c.id))continue;
  const date=last.get(c.id);if(!date||date>cutoff)continue;
  add('clientes','inactive',c,{clientId:c.id,clientName:c.name||'Cliente',phone:c.phone||c.whatsapp||'',date,title:'Cliente por recuperar',detail:'Sin servicio registrado desde '+date,source:'clients',priority:2});
 }
 return rows.sort((a,b)=>a.priority-b.priority||a.date.localeCompare(b.date)||a.clientName.localeCompare(b.clientName,'es'));
}
const phoneDigits=p=>{let d=String(p||'').replace(/\D/g,'');if(d.length===10)d='1'+d;return d.length>=11&&d.length<=15?d:'';};
const localDate=d=>d?new Date(d+'T12:00:00').toLocaleDateString('es-PR',{day:'numeric',month:'long',year:'numeric'}):'';
const clock=s=>{if(!/^\d{2}:\d{2}$/.test(s||''))return 'por coordinar';const[h,m]=s.split(':').map(Number);return (h%12||12)+':'+String(m).padStart(2,'0')+(h>=12?' p. m.':' a. m.');};
export function alertMessage(a,business,money){
 const hello='Hola, '+a.clientName+'. Te saludamos de '+(business||'nuestro negocio')+'.\n\n';
 if(a.category==='agenda')return hello+'Te recordamos tu cita de '+a.service+' para el '+localDate(a.date)+' a las '+clock(a.time)+'. '+(a.pending?'Por favor, confírmanos tu asistencia.':'Gracias por confirmar. Nos vemos en tu cita.');
 if(a.category==='cobros')return hello+'Según nuestros registros, la factura '+a.number+' tiene un balance pendiente de '+money(a.balance)+'. ¿Podrías confirmarnos cuándo podemos coordinar el pago? Si ya realizaste el pago, por favor ignora este recordatorio y compártenos el comprobante. Gracias.';
 if(a.category==='seguimientos')return hello+'Queríamos dar seguimiento a '+a.detail+'. ¿Te gustaría que coordinemos una fecha? Quedamos a tu disposición.';
 return hello+'Según nuestro registro, tu último servicio fue en '+new Date(a.date+'T12:00:00').toLocaleDateString('es-PR',{month:'long',year:'numeric'})+'. Quería saber cómo está funcionando tu equipo. Si deseas coordinar un servicio o mantenimiento, podemos ayudarte con una fecha.';
}
export function createAlertCenter({$,state,today,invoiceBalance,invoiceStatus,money,docRef,updateDoc,showMobileNotice,esc}){
 let category='all',rows=[],working=new Set();
 const settings=()=>({day:today(),invoiceBalance,invoiceStatus,inactiveDays:180});
 function render(){
  if(!state.profile)return;
  rows=deriveAlerts(state,settings());
  $('novaAlertCount').textContent=rows.length>99?'99+':String(rows.length);
  $('novaAlertCount').hidden=rows.length===0;
  $('novaAlertSummary').textContent=rows.length?rows.length+' asuntos requieren atención':'Todo al día';
  $('novaAlertPreview').textContent=rows.length?rows.slice(0,2).map(r=>r.title+' · '+r.clientName).join(' / '):'No tienes avisos pendientes.';
  const list=rows.filter(r=>category==='all'||r.category===category);
  $('novaAlertsList').innerHTML=list.length?list.map(a=>{
    const digits=phoneDigits(a.phone),key=a.source+':'+a.id+':'+a.key;
    const action=a.category==='agenda'&&a.pending?'<button type="button" data-agenda-share="'+esc(a.id)+'">Enviar confirmación</button>':digits?'<a target="_blank" rel="noopener noreferrer" href="https://wa.me/'+digits+'?text='+encodeURIComponent(alertMessage(a,state.profile.businessName,money))+'">Preparar WhatsApp</a>':'<span class="nova-alert-muted">Sin teléfono</span>';
    const route={services:'mAgenda',invoices:'mReceivable',followups:'mFollowups',clients:'mClients'}[a.source];
    return '<article class="nova-alert-card"><div class="nova-alert-row"><span class="nova-alert-symbol '+esc(a.category)+'">'+({agenda:'◷',cobros:'$',seguimientos:'↗',clientes:'+'}[a.category])+'</span><div><small>'+esc(a.category==='cobros'?'COBROS':a.category==='agenda'?'AGENDA':a.category==='clientes'?'CLIENTES':'SEGUIMIENTOS')+'</small><h4>'+esc(a.title)+'</h4><p>'+esc(a.clientName)+'</p></div></div><p class="nova-alert-detail">'+esc(a.detail)+(a.category==='cobros'?' · '+esc(money(a.balance)):'')+'</p><small>'+esc(localDate(a.date))+'</small><div class="nova-alert-actions">'+action+'<button data-tab="'+route+'" type="button">Ver módulo</button><button type="button" data-alert-snooze="'+esc(key)+'" '+(working.has(key)?'disabled':'')+'>Posponer</button></div></article>';
  }).join(''):'<div class="empty">No hay avisos en esta categoría.</div>';
  document.querySelectorAll('[data-alert-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.alertFilter===category);b.setAttribute('aria-pressed',String(b.dataset.alertFilter===category));});
 }
 document.querySelectorAll('[data-alert-filter]').forEach(b=>b.addEventListener('click',()=>{category=b.dataset.alertFilter;render();}));
 $('novaAlertRefresh').addEventListener('click',render);
 document.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-alert-snooze]');if(!btn)return;
  const key=btn.dataset.alertSnooze,r=rows.find(a=>a.source+':'+a.id+':'+a.key===key);
  if(!r||working.has(key))return;
  const record=state[r.source].find(x=>x.id===r.id);if(!record)return;
  working.add(key);btn.disabled=true;
  try{const until=shift(today(),r.category==='clientes'?30:1);await updateDoc(docRef(r.source,r.id),{novaAlertSnooze:{...(record.novaAlertSnooze||{}),[r.key]:until}});showMobileNotice('Aviso pospuesto hasta '+localDate(until),'ok');}
  catch(e){showMobileNotice(e.message||'No se pudo posponer','danger');}
  finally{working.delete(key);render();}
 });
 window.addEventListener('focus',render);setInterval(()=>{if(!document.hidden)render();},60000);
 return {render};
}
