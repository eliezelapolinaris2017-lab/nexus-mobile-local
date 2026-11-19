// Agenda local: las citas y los trabajos comparten la colección services.
export function createAgenda({$,state,clientBy,today,esc,phoneLink,statusBadge,colRef,docRef,addDoc,updateDoc,serverTimestamp,switchTab,showMobileNotice}){
 const dateKey=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
 const asDate=s=>new Date(s+'T12:00:00');
 const move=(s,n)=>{const d=asDate(s);d.setDate(d.getDate()+n);return dateKey(d);};
 const dateLabel=(s,opts)=>asDate(s).toLocaleDateString('es-PR',opts||{weekday:'long',day:'numeric',month:'long'});
 const inactive=s=>['Completado','Completada','Cancelado','Cancelada','Facturado'].includes(s.status||s.fields?.[3]||'');
 const timeLabel=s=>{if(!s)return 'Sin hora';const [h,m]=s.split(':').map(Number);return ((h%12)||12)+':'+String(m).padStart(2,'0')+(h>=12?' p. m.':' a. m.');};
 const mins=s=>{const [h,m]=String(s||'').split(':').map(Number);return h*60+m;};
 let selected=today(),month=selected.slice(0,7),mode='day',editId=null,busy=false,returnDraft=null;
 const editor=$('agendaEditor'),form=$('agendaForm'),client=$('agendaClient');
 const services=()=>state.services.filter(s=>s.date&&/^\d{4}-\d{2}-\d{2}$/.test(s.date));
 function clients(){const prev=client.value;client.replaceChildren(new Option('Seleccionar cliente',''),...state.clients.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'es')).map(c=>new Option(c.name||'Cliente',c.id)));if([...client.options].some(o=>o.value===prev))client.value=prev;}
 function render(){
  const rows=services(),open=rows.filter(s=>!inactive(s)),now=today(),next=move(now,6);
  $('agendaTodayCount').textContent=open.filter(s=>s.date===now).length+' citas';$('agendaTodayDate').textContent=dateLabel(now);
  const first=asDate(month+'-01'),offset=(first.getDay()+6)%7,total=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  $('agendaMonth').textContent=first.toLocaleDateString('es-PR',{month:'long',year:'numeric'});
  const counts=new Map();for(const s of open)counts.set(s.date,(counts.get(s.date)||0)+1);
  $('agendaDays').innerHTML=Array.from({length:Math.ceil((offset+total)/7)*7},(_,i)=>{const d=i-offset+1;if(d<1||d>total)return '<span></span>';const key=month+'-'+String(d).padStart(2,'0'),n=counts.get(key)||0;return '<button type="button" data-agenda-date="'+key+'" class="agenda-day'+(key===selected?' selected':'')+(key===now?' today':'')+'" aria-label="'+esc(dateLabel(key))+(n?', '+n+' citas':'')+'" aria-pressed="'+(key===selected)+'">'+d+(n?'<span class="agenda-dot"></span>':'')+'</button>';}).join('');
  document.querySelectorAll('[data-agenda-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.agendaMode===mode);b.setAttribute('aria-pressed',String(b.dataset.agendaMode===mode));});
  const q=$('agendaSearch').value.trim().toLowerCase();
  const visible=rows.filter(s=>mode==='day'?s.date===selected:mode==='next'?s.date>=now&&s.date<=next&&!inactive(s):mode==='overdue'?s.date<now&&!inactive(s):true).filter(s=>[s.title,s.clientName,clientBy(s.clientId).name,s.note,s.address].join(' ').toLowerCase().includes(q)).sort((a,b)=>(a.date+' '+(a.time||'99:99')).localeCompare(b.date+' '+(b.time||'99:99')));
  $('agendaListTitle').textContent=mode==='day'?dateLabel(selected):mode==='next'?'Próximos 7 días':mode==='overdue'?'Citas atrasadas':'Todas las citas';
  $('agendaListCount').textContent=visible.length+' citas';
  $('mAgendaList').innerHTML=visible.length?visible.map(s=>{const c=clientBy(s.clientId),address=s.address||c.address||c.city||'',phone=phoneLink(c),done=inactive(s);return '<article class="row-card agenda-record"><div class="agenda-record-top"><div class="agenda-time"><strong>'+esc(timeLabel(s.time))+'</strong><small>'+esc(s.duration?s.duration+' min':'')+'</small></div><div class="agenda-record-text"><h4>'+esc(s.title||s.serviceType||'Servicio')+'</h4><p>'+esc(s.clientName||c.name||'Cliente')+'</p><p>'+esc(dateLabel(s.date,{day:'numeric',month:'short'}))+'</p></div>'+statusBadge(s.status||'Programado')+'</div>'+(address?'<p>'+esc(address)+'</p>':'')+(s.note?'<p class="agenda-note">'+esc(s.note)+'</p>':'')+'<div class="actions">'+(!done?'<button type="button" data-agenda-edit="'+esc(s.id)+'">Editar / mover</button><button type="button" data-agenda-done="'+esc(s.id)+'">Completar</button><button type="button" data-agenda-cancel="'+esc(s.id)+'">Cancelar cita</button>':'')+(s.clientId&&s.status!=='Cancelado'&&s.status!=='Cancelada'?'<button type="button" data-new-invoice-client="'+esc(s.clientId)+'">Facturar</button>':'')+(phone?'<a href="'+phone+'" target="_blank" rel="noopener">WhatsApp</a>':'')+(address?'<a href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address)+'" target="_blank" rel="noopener">Ruta</a>':'')+'</div></article>';}).join(''):'<div class="empty agenda-empty">No hay citas para este periodo.<br><button type="button" data-agenda-create>+ Programar cita</button></div>';
  clients();
  if(returnDraft&&document.querySelector('#mAgenda.active')&&!editor.open){const draft=returnDraft;returnDraft=null;openEditor(null,draft);}
 }
 function openEditor(s,draft){
  editId=s?.id||draft?.id||null;form.reset();clients();const v=s||draft||{};
  $('agendaEditorTitle').textContent=editId?'Editar cita':'Nueva cita';client.value=v.clientId||'';
  $('agendaTitle').value=v.title||'';$('agendaDate').value=v.date||selected;$('agendaTime').value=v.time||'08:00';$('agendaDuration').value=String(v.duration||60);$('agendaAddress').value=v.address||'';$('agendaNote').value=v.note||'';$('agendaError').textContent='';
  if(!editor.open)editor.showModal();
 }
 function changeMonth(n){const d=asDate(month+'-01');d.setMonth(d.getMonth()+n);month=dateKey(d).slice(0,7);selected=month+'-01';mode='day';render();}
 $('agendaPrev').onclick=()=>changeMonth(-1);$('agendaNext').onclick=()=>changeMonth(1);
 $('agendaToday').onclick=()=>{selected=today();month=selected.slice(0,7);mode='day';render();};
 $('agendaNew').onclick=()=>openEditor();$('agendaClose').onclick=()=>editor.close();$('agendaSearch').oninput=render;
 client.onchange=()=>{const c=clientBy(client.value);$('agendaAddress').value=c.address||c.city||'';};
 $('agendaNewClient').onclick=()=>{returnDraft={id:editId,clientId:client.value,title:$('agendaTitle').value,date:$('agendaDate').value,time:$('agendaTime').value,duration:Number($('agendaDuration').value),address:$('agendaAddress').value,note:$('agendaNote').value};editor.close();switchTab('mClients');$('mNewClientPanel').open=true;$('mClientName').focus();};
 function acceptNewClient(id){if(!returnDraft)return false;returnDraft.clientId=id;returnDraft.address=clientBy(id).address||clientBy(id).city||'';switchTab('mAgenda');return true;}
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;const c=clientBy(client.value),title=$('agendaTitle').value.trim(),date=$('agendaDate').value,time=$('agendaTime').value,duration=Number($('agendaDuration').value);
  if(!c.id||!title||!date||!time||!Number.isFinite(duration)){ $('agendaError').textContent='Completa cliente, servicio, fecha y hora.';return;}
  if(mins(time)+duration>1440){$('agendaError').textContent='La cita debe terminar el mismo día.';return;}
  const conflict=services().find(s=>s.id!==editId&&!inactive(s)&&s.date===date&&s.time&&mins(time)<mins(s.time)+Number(s.duration||60)&&mins(time)+duration>mins(s.time));
  if(conflict&&!confirm('Ya tienes una cita durante ese horario: '+(conflict.title||'Servicio')+'. ¿Guardar de todas formas?'))return;
  busy=true;$('agendaSave').disabled=true;$('agendaError').textContent='';
  try{const record={clientId:c.id,clientName:c.name,title,date,time,duration,address:$('agendaAddress').value.trim(),note:$('agendaNote').value.trim(),status:'Programado',updatedAt:serverTimestamp()};if(editId){await updateDoc(docRef('services',editId),record);state.services=state.services.map(s=>s.id===editId?{...s,...record}:s);}else{record.createdAt=serverTimestamp();const ref=await addDoc(colRef('services'),record);if(!state.services.some(s=>s.id===ref.id))state.services.push({...record,id:ref.id});}
  selected=date;month=date.slice(0,7);mode='day';editor.close();render();showMobileNotice('Cita guardada','ok');
  }catch(err){$('agendaError').textContent=err.message||'No se pudo guardar';}finally{busy=false;$('agendaSave').disabled=false;}
 });
 document.addEventListener('click',async e=>{const day=e.target.closest('[data-agenda-date]');if(day){selected=day.dataset.agendaDate;mode='day';render();return;}const filter=e.target.closest('[data-agenda-mode]');if(filter){mode=filter.dataset.agendaMode;render();return;}if(e.target.closest('[data-agenda-create]')){openEditor();return;}const edit=e.target.closest('[data-agenda-edit]');if(edit){const s=state.services.find(s=>s.id===edit.dataset.agendaEdit);if(s)openEditor(s);return;}const action=e.target.closest('[data-agenda-done],[data-agenda-cancel]');if(!action||action.disabled)return;const done=!!action.dataset.agendaDone,id=action.dataset.agendaDone||action.dataset.agendaCancel,status=done?'Completado':'Cancelado';if(!confirm(done?'¿Completar esta cita?':'¿Cancelar esta cita? Se conservará en el historial.'))return;action.disabled=true;try{await updateDoc(docRef('services',id),{status,updatedAt:serverTimestamp()});state.services=state.services.map(s=>s.id===id?{...s,status}:s);render();showMobileNotice(done?'Cita completada':'Cita cancelada','ok');}catch(err){showMobileNotice(err.message,'danger');}finally{action.disabled=false;}});
 return {render,acceptNewClient};
}
