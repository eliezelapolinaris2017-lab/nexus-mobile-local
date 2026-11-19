const CFG='nexus-local-confirmations-config-v1';
const validRef=s=>/^[a-z0-9]{20}$/.test(s);
const validKey=s=>/^[a-f0-9]{64}$/.test(s);
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const inactive=s=>['Completado','Completada','Cancelado','Cancelada','Facturado'].includes(s.status);
function getConfig(){try{const c=JSON.parse(localStorage.getItem(CFG)||'null');return c&&validRef(c.ref)&&validKey(c.key)?c:null;}catch{return null;}}
async function request(c,body){const r=await fetch('https://'+c.ref+'.supabase.co/functions/v1/nova-confirmations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,ownerKey:c.key}),cache:'no-store',signal:AbortSignal.timeout(12000)});const v=await r.json();if(!r.ok)throw Error(v.error||'No se pudo conectar');return v;}
export function appointmentMessage(s,c,profile,link){
 const day=new Date(s.date+'T12:00:00').toLocaleDateString('es-PR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
 const [h,m]=String(s.time||'').split(':').map(Number),time=s.time?((h%12)||12)+':'+String(m).padStart(2,'0')+(h>=12?' p. m.':' a. m.'):'Por coordinar';
 return '¡Hola, '+(c.name||s.clientName||'cliente')+'! 👋\n\n'+(profile?.businessName||'Nuestro negocio')+' le informa que su cita está programada:\n\n📅 '+day+'\n🕒 '+time+'\n🔧 '+(s.title||'Servicio')+(s.address?'\n📍 '+s.address:'')+'\n\n'+(link?'Por favor, confirme su asistencia en este enlace:\n'+link:'Por favor, confirme su asistencia respondiendo a este mensaje.')+'\n\n¡Gracias!';
}
export function createConfirmations({$,state,clientBy,phoneLink,statusBadge,docRef,updateDoc,serverTimestamp,showMobileNotice,render}){
 const dialog=$('confirmShareDialog'),anchor=$('confirmWhatsApp');let current=null,polling=false,preparing=false;
 const config=getConfig();if(config)$('confirmProject').value=config.ref;
 function configLabel(){const cfg=getConfig();$('confirmConfigStatus').textContent=cfg?'Conexión configurada. Las confirmaciones se consultan con internet.':'Sin conexión: enlaces de confirmación no disponibles. El mensaje de WhatsApp sí se puede preparar.';}
 configLabel();
 $('confirmConfigForm').addEventListener('submit',async e=>{e.preventDefault();const ref=$('confirmProject').value.trim(),key=$('confirmOwnerKey').value.trim();if(!validRef(ref)||!validKey(key)){showMobileNotice('Revisa la referencia y la clave privada de agenda.','danger');return;}try{await request({ref,key},{action:'ping'});const previous=getConfig();if(previous&&(previous.ref!==ref||previous.key!==key)&&state.services.some(s=>s.confirmationInvite&&!inactive(s)))throw Error('Hay enlaces vigentes; cancela o completa las citas antes de cambiar la conexión.');localStorage.setItem(CFG,JSON.stringify({ref,key}));$('confirmOwnerKey').value='';configLabel();showMobileNotice('Confirmaciones conectadas','ok');refresh();}catch(err){showMobileNotice(err.message,'danger');}});
 $('confirmDisconnect').onclick=()=>{if(state.services.some(s=>s.confirmationInvite&&!inactive(s))){showMobileNotice('Hay enlaces vigentes. Cancélalos antes de desconectar.','danger');return;}localStorage.removeItem(CFG);configLabel();};
 async function patch(s,fields){await updateDoc(docRef('services',s.id),fields);state.services=state.services.map(r=>r.id===s.id?{...r,...fields}:r);}
 async function revoke(s){if(!s.confirmationInvite)return;const cfg=getConfig();if(!cfg||cfg.ref!==s.confirmationInvite.ref)throw Error('Conecta la nube original para invalidar el enlace anterior.');await request(cfg,{action:'revoke',id:s.confirmationInvite.id});}
 function badge(s){if(inactive(s))return '';const labels={confirmed:'Confirmada por cliente',pending:'Esperando confirmación',expired:'Enlace vencido','not-sent':'Sin enviar'};return '<div class="confirm-status '+(s.confirmationState==='confirmed'?'confirmed':'')+'">'+(labels[s.confirmationState]||'Sin enviar')+'</div>';}
 function paint(s,link,status){const c=clientBy(s.clientId),phone=phoneLink(c);$('confirmMessage').value=appointmentMessage(s,c,state.profile,link);$('confirmShareStatus').textContent=status+(phone?'':' El cliente no tiene teléfono registrado.');anchor.hidden=!phone;if(phone)anchor.href=phone+'?text='+encodeURIComponent($('confirmMessage').value);}
 async function prepare(){if(preparing||!current)return;const s=state.services.find(x=>x.id===current);if(!s||inactive(s))return;const cfg=getConfig();if(!cfg){paint(s,'','Mensaje preparado. Falta conectar Supabase para incluir el enlace automático.');return;}
 if(s.confirmationState==='confirmed'){paint(s,'','Esta cita ya fue confirmada. Puedes enviar un recordatorio.');return;}
 preparing=true;$('confirmShareRetry').disabled=true;anchor.hidden=true;$('confirmShareStatus').textContent='Preparando enlace seguro…';
 try{let inv=s.confirmationInvite;
 if(inv&&inv.ref!==cfg.ref)throw Error('El enlace pertenece a otra conexión.');
 if(inv&&Date.parse(inv.expires)<=Date.now()){await revoke(s);inv=null;}
 if(!inv){const expires=new Date(s.date+'T23:59:59-04:00').toISOString();if(Date.parse(expires)<=Date.now())throw Error('No se pueden generar enlaces para citas pasadas.');inv={id:crypto.randomUUID(),token:random(),ref:cfg.ref,expires};await request(cfg,{action:'create',id:inv.id,token:inv.token,expires});try{await patch(s,{confirmationInvite:inv,confirmationState:'pending',confirmedAt:null});}catch(e){await request(cfg,{action:'revoke',id:inv.id}).catch(()=>{});throw e;}render();}
 const link=new URL('confirmar.html',location.href);link.hash=inv.ref+'.'+inv.token;
 paint(s,link.href,'Enlace listo. Presiona Abrir WhatsApp y envía el mensaje.');
 }catch(err){paint(s,'','No se pudo generar enlace: '+err.message+' Puedes enviar el mensaje sin enlace o reintentar.');}finally{preparing=false;$('confirmShareRetry').disabled=false;}
 }
 function open(id){if(preparing)return;current=id;const s=state.services.find(x=>x.id===id);if(!s)return;if(!dialog.open)dialog.showModal();paint(s,'','Preparando mensaje…');prepare();}
 $('confirmShareClose').onclick=()=>dialog.close();$('confirmShareRetry').onclick=prepare;
 async function refresh(){const cfg=getConfig();if(!cfg||polling||!navigator.onLine||document.hidden)return;polling=true;try{const rows=state.services.filter(s=>s.confirmationInvite?.ref===cfg.ref);let changed=false;for(const s of rows.filter(inactive)){try{await revoke(s);await patch(s,{confirmationInvite:null});changed=true;}catch{}}
 const live=rows.filter(s=>!inactive(s)&&s.confirmationState==='pending');for(let i=0;i<live.length;i+=50){const batch=live.slice(i,i+50),res=await request(cfg,{action:'status',ids:batch.map(s=>s.confirmationInvite.id)});for(const s of batch){const item=res.items?.find(v=>v.id===s.confirmationInvite.id);if(!item)continue;const next=item.state==='confirmed'?'confirmed':['expired','revoked'].includes(item.state)?'expired':'pending';const currentRecord=state.services.find(v=>v.id===s.id);if(next!==s.confirmationState&&currentRecord?.confirmationInvite?.id===s.confirmationInvite.id&&!inactive(currentRecord)){await patch(currentRecord,{confirmationState:next,confirmedAt:item.confirmedAt||null});changed=true;}}}if(changed)render();}catch(e){console.warn('Confirmaciones: '+e.message);}finally{polling=false;}}
 window.addEventListener('online',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});setInterval(refresh,30000);
 return {open,badge,revoke,refresh};
}
