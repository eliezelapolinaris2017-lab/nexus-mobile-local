// Private NOVA cloud workspace. Public API key only; data requires Supabase Auth.
import {cloudSnapshot,acknowledgeCloud,applyCloudSnapshot} from './local-db.js';
const BASE='https://cgpfpxueqciefclonghz.supabase.co';
const API='sb_publishable_C80PjdtDeDfIT2z5EnUh5g_CiOUlUoG';
const SESSION='nova-cloud-session-v1';
const AUTH_RETURN=location.origin==='https://nova.nexustoolspr.com'?'https://nova.nexustoolspr.com/':'https://eliezelapolinaris2017-lab.github.io/nexus-mobile-local/';
let nextSignupAt=0,nextRecoveryAt=0,authWorking=false,recoveryToken=null;
function authError(e){
 const code=e.code||'';
 if(e.status===429||code==='over_email_send_rate_limit'||code==='over_request_rate_limit')return 'Supabase ha limitado temporalmente los envíos de correo. No crees otra cuenta. Usa el enlace de verificación que ya recibiste y luego inicia sesión; si no llegó, vuelve a intentar más tarde.';
 if(code==='email_not_confirmed')return 'Tu correo aún no está confirmado. Abre el enlace recibido o pulsa Reenviar confirmación; luego inicia sesión.';
 if(code==='invalid_credentials'||/invalid login credentials/i.test(e.message))return 'Correo o contraseña incorrectos. Si ya creaste y verificaste tu cuenta, utiliza esos mismos datos.';
 if(code==='user_already_exists')return 'Ya existe una cuenta con este correo. Inicia sesión.';
 if(code==='email_address_not_authorized')return 'El servicio gratuito de correo de Supabase todavía no admite esta dirección. Es necesario configurar un remitente SMTP autorizado.';
 return e.message||'No se pudo conectar. Comprueba tu internet.';
}
function authControls(busy){authWorking=busy;document.querySelectorAll('[data-cloud-form] button[type=submit]').forEach(b=>{b.disabled=busy;});}
const LEGACY='nexus-local-confirmations-config-v1';
export const PROJECT_REF='cgpfpxueqciefclonghz';
let ready=false,openApp=null,transitioning=false;
export const cloudReady=()=>ready&&!!session;
export async function confirmationRequest(body){return request('/functions/v1/nova-confirmations',{method:'POST',access:await access(),body});}
function legacyKey(){try{const c=JSON.parse(localStorage.getItem(LEGACY)||'null');return c?.ref===PROJECT_REF&&/^[a-f0-9]{64}$/.test(c.key)?c.key:null;}catch{return null;}}
async function activateConfirmations(importLegacy=false){const key=importLegacy?legacyKey():null;await confirmationRequest({action:'provision',...(key?{legacyKey:key}:{})});if(key)localStorage.removeItem(LEGACY);}
const el=id=>document.getElementById(id);
function view(stage){el('mobileAuth').dataset.stage=stage;el('mobileAuth').classList.toggle('hidden',stage==='app');el('mobileApp').classList.add('hidden');el('novaLoginPanel').hidden=stage!=='login';el('novaOnboarding').hidden=stage!=='onboarding';el('novaMigration').hidden=stage!=='migration';el('novaPasswordReset').hidden=stage!=='reset';el('novaAuthTitle').textContent=stage==='reset'?'Recupera tu acceso.':stage==='onboarding'?'Configura tu empresa.':stage==='migration'?'Vincula tu negocio.':'Accede a tu cuenta.';el('novaAuthSubtitle').textContent=stage==='reset'?'SEGURIDAD DE CUENTA':stage==='onboarding'?'PASO 2 DE 2 · TU EMPRESA':stage==='migration'?'CONSERVA TUS DATOS':'ACCESO A TU EMPRESA';}
function message(s){el('mobileAuthMsg').textContent=s||'';}
// Account entitlement is calculated by Supabase, not the device clock.
let billingBusy=false;
function paintBilling(title,detail,state='pending'){
 const card=el('novaBillingCard');if(!card)return;
 card.dataset.state=state;el('novaBillingTitle').textContent=title;el('novaBillingDetail').textContent=detail;
}
async function refreshBilling(){
 if(!session||billingBusy)return;
 if(!navigator.onLine){paintBilling('Sin conexión','Conéctate a internet para consultar el estado de tu plan. Tus datos locales se conservan.');return;}
 billingBusy=true;const owner=session.user.id;
 try{
  const result=await request('/rest/v1/rpc/nova_billing_status',{method:'POST',access:await access(),body:{}});
  if(session?.user.id!==owner)return;
  if(!result||typeof result.status!=='string')throw Error('Estado de plan no disponible');
  const ms=Date.parse(result.trial_ends_at)-Date.parse(result.server_time);
  const days=Math.max(0,Math.ceil(ms/86400000));
  const date=Number.isFinite(Date.parse(result.trial_ends_at))?new Date(result.trial_ends_at).toLocaleDateString('es-PR',{year:'numeric',month:'long',day:'numeric',timeZone:'America/Puerto_Rico'}):'';
  if(result.status==='founder')paintBilling('Cuenta fundadora','Tu acceso actual se conserva durante el lanzamiento. No hay cobros automáticos.','active');
  else if(result.status==='active')paintBilling('Plan activo','Acceso vigente.','active');
  else if(result.status==='trialing'&&Number.isFinite(ms))paintBilling('Prueba gratuita · '+days+' día'+(days===1?'':'s')+' restante'+(days===1?'':'s'),'Disponible hasta el '+date+'. Sin tarjeta ni cobros automáticos.','active');
  else if(result.status==='trial_ended')paintBilling('Prueba finalizada','Tu información permanece disponible. Los cobros y las restricciones estarán disponibles cuando se active la facturación.','ended');
  else paintBilling('Plan pendiente','Confirma tu correo para iniciar la prueba.');
 }catch(e){if(session?.user.id===owner)paintBilling('No se pudo consultar el plan','Reintenta con conexión a internet. El acceso y tus datos no se modificaron.');}
 finally{billingBusy=false;}
}
async function enter(){await openApp();ready=true;el('mobileAuth').classList.add('hidden');el('mobileApp').classList.remove('hidden');window.dispatchEvent(new Event('nova-cloud-ready'));refreshBilling();schedule();}
async function hydrate(){
 if(!session||transitioning)return;transitioning=true;ready=false;
 try{
  const local=await assertOwner(),owner=session.user.id;
  if(!navigator.onLine){if(local.binding?.owner===owner&&local.snapshot.profile){await enter();paint('Sin internet · guardado local.');return;}throw Error('Necesitas internet para vincular tu cuenta por primera vez.');}
  const remote=await getRow(owner,true);
  if(local.binding&&local.snapshot.profile){
   if(!remote)throw Error('No se encontró tu base vinculada. No se reemplazaron tus datos.');
   if(Number(remote.revision)!==local.binding.version&&local.revision===local.binding.syncedRevision)await applyCloudSnapshot(remote.snapshot,owner,Number(remote.revision),local.revision);
   await activateConfirmations(true);await enter();message('');return;
  }
  if(local.snapshot.profile){view('migration');el('novaMigrationText').textContent=remote?'Existe una empresa en Supabase y otra copia en este teléfono. Recupera la nube después de exportar un respaldo.':'Encontramos tu empresa y datos en este dispositivo. Vincúlalos para conservarlos en Supabase.';el('novaMigrateLocal').hidden=!!remote;el('novaMigrateRemote').hidden=!remote;message('');return;}
  if(remote){await applyCloudSnapshot(remote.snapshot,owner,Number(remote.revision),local.revision);await activateConfirmations(false);await enter();message('');return;}
  view('onboarding');message('');
 }catch(e){if(e.status===401||!session){saveSession(null);view('login');}else{view('migration');el('novaMigrationText').textContent='No se pudo vincular la cuenta. Tus registros no se han borrado.';el('novaMigrateLocal').hidden=true;el('novaMigrateRemote').hidden=true;}paint(e.message);message(e.message);}
 finally{transitioning=false;}
}
export async function finishOnboarding(importLegacy=false){
 if(!session||transitioning||busy)throw Error('Inicia sesión o termina la operación anterior.');
 transitioning=true;
 try{const local=await assertOwner(),owner=session.user.id;if(!local.snapshot.profile)throw Error('Completa los datos de tu empresa.');if(!navigator.onLine)throw Error('Conéctate a internet para guardar tu empresa.');
 const existing=await getRow(owner);
 if(existing){if(!local.binding||local.binding.owner!==owner)throw Error('Ya existe una empresa en la nube. Recupérala en lugar de reemplazarla.');await activateConfirmations(importLegacy);}
 else{await activateConfirmations(importLegacy);const result=await request('/rest/v1/nova_workspaces?select=revision,updated_at',{method:'POST',access:await access(),prefer:'return=representation',body:{owner_id:owner,snapshot:local.snapshot}});if(!result?.[0])throw Error('No se pudo verificar la primera copia.');await acknowledgeCloud(owner,0,Number(result[0].revision),local.revision);synced(result[0]);}
 await enter();message('');
 }finally{transitioning=false;}
}
let session=null,busy=false,timer=null,refreshPromise=null,stopped=false;
try{session=JSON.parse(sessionStorage.getItem(SESSION)||'null');}catch{}
function saveSession(s){session=s;if(!s)ready=false;try{if(s)sessionStorage.setItem(SESSION,JSON.stringify(s));else sessionStorage.removeItem(SESSION);}catch{}}
async function request(path,{method='GET',body,access,prefer}={}){
 const headers={apikey:API,'Content-Type':'application/json'};
 if(access)headers.Authorization='Bearer '+access;
 if(prefer)headers.Prefer=prefer;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
 let r;
 try{r=await fetch(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:controller.signal,referrerPolicy:'no-referrer'});}
 catch(e){if(e.name==='AbortError')throw Error('La conexión tardó demasiado. Reintenta sin borrar tus datos.');throw e;}
 finally{clearTimeout(timeout);}
 const v=await r.json().catch(()=>null);
 if(!r.ok){const e=Error(v?.msg||v?.message||v?.error_description||v?.error||'No se pudo conectar a Supabase.');e.status=r.status;e.code=v?.error_code||v?.code||v?.error||'';throw e;}
 return v;
}
function useSession(s){if(!s?.access_token||!s?.refresh_token||!s?.user?.id)throw Error('Verifica tu correo e inicia sesión.');saveSession({access_token:s.access_token,refresh_token:s.refresh_token,user:{id:s.user.id,email:s.user.email},expires_at:s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600)});}
async function access(){
 if(!session)throw Error('Inicia sesión en NOVA.');
 if(session.expires_at>Date.now()/1000+90)return session.access_token;
 if(!refreshPromise){refreshPromise=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}}).then(s=>{useSession(s);return session.access_token;}).catch(e=>{if(e.status===400||e.status===401){saveSession(null);location.reload();}throw e;}).finally(()=>refreshPromise=null);}
 return refreshPromise;
}
function paint(msg){document.querySelectorAll('[data-cloud-status]').forEach(e=>e.textContent=msg);document.querySelectorAll('[data-cloud-login]').forEach(e=>e.hidden=!!session);document.querySelectorAll('[data-cloud-actions]').forEach(e=>e.hidden=!session);
 const pill=el('mobileSync');if(!pill||!ready)return;
 pill.dataset.cloudMode='active';
 const state=msg.startsWith('☁ Guardado')?'saved':msg.startsWith('Sin internet')?'offline':msg.startsWith('Guardando')?'pending':/Conflicto|versión más reciente|Pendiente de sincronizar/i.test(msg)?'warning':'pending';
 pill.dataset.cloudState=state;pill.textContent=state==='saved'?'☁ En Supabase':state==='offline'?'Sin internet':state==='warning'?'Revisar guardado':'Sincronizando…';
}
const rowPath=owner=>'/rest/v1/nova_workspaces?owner_id=eq.'+encodeURIComponent(owner);
async function getRow(owner,full=false){const rows=await request(rowPath(owner)+'&select='+(full?'revision,snapshot,updated_at':'revision,updated_at'),{access:await access()});return rows?.[0]||null;}
async function assertOwner(){const local=await cloudSnapshot();if(local.binding&&local.binding.owner!==session.user.id)throw Error('Este dispositivo está vinculado a otra cuenta. No se subirán ni reemplazarán datos.');return local;}
function synced(r){paint('☁ Guardado en Supabase · '+(r?.updated_at?new Date(r.updated_at).toLocaleString('es-PR'):'ahora'));}
async function sync({initial=false}={}){
 if(!session||!ready||busy||stopped||transitioning)return;
 if(!navigator.onLine){paint('Sin internet · cambios guardados en este dispositivo.');return;}
 busy=true;
 try{
  const local=await assertOwner(),owner=session.user.id,remote=await getRow(owner);
  if(!local.binding){
   if(remote){paint(local.snapshot.profile?'Existe una base en la nube. Usa Recuperar para revisar la copia antes de reemplazar datos locales.':'Tu empresa está en la nube. Pulsa Recuperar datos.');return;}
   if(!local.snapshot.profile){paint('Cuenta lista. Configura tu empresa y activa la copia desde Ajustes.');return;}
   if(!initial){paint('Cuenta conectada. Pulsa Subir datos locales para activar el guardado automático.');return;}
   if(!confirm('¿Guardar en Supabase todos los datos actuales de NOVA? Se conservará la copia local.'))return;
   const result=await request('/rest/v1/nova_workspaces?select=revision,updated_at',{method:'POST',access:await access(),prefer:'return=representation',body:{owner_id:owner,snapshot:local.snapshot}});
   if(!result?.[0])throw Error('No se pudo verificar la primera copia.');
   await acknowledgeCloud(owner,0,Number(result[0].revision),local.revision);synced(result[0]);return;
  }
  if(!remote)throw Error('No se encontró la copia vinculada. No se reemplazará automáticamente.');
  const dirty=local.revision!==local.binding.syncedRevision;
  if(Number(remote.revision)!==local.binding.version){paint(dirty?'Conflicto: hay cambios en este dispositivo y en la nube. Exporta un respaldo local antes de recuperar la nube.':'Hay una versión más reciente en Supabase. Pulsa Recuperar datos cuando termines de editar.');return;}
  if(!dirty){synced(remote);return;}
  paint('Guardando cambios en Supabase…');
  const result=await request(rowPath(owner)+'&revision=eq.'+local.binding.version+'&select=revision,updated_at',{method:'PATCH',access:await access(),prefer:'return=representation',body:{snapshot:local.snapshot}});
  if(!result?.[0])throw Error('La nube cambió durante el guardado. No se sobrescribieron los datos.');
  await acknowledgeCloud(owner,local.binding.version,Number(result[0].revision),local.revision);synced(result[0]);
 }catch(e){paint('Pendiente de sincronizar: '+e.message);console.warn('NOVA cloud:',e.message);}
 finally{busy=false;}
}
async function recover(){
 if(!session||busy)return;busy=true;
 try{
  const local=await assertOwner(),owner=session.user.id,remote=await getRow(owner,true);
  if(!remote){paint('Todavía no hay datos en Supabase.');return;}
  const dirty=local.snapshot.profile&&(!local.binding||local.revision!==local.binding.syncedRevision);
  if(dirty){const blob=new Blob([JSON.stringify(local.snapshot)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='nova-local-antes-de-recuperar.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
   if(!confirm('Se inició la descarga de un respaldo local. ¿Confirmas reemplazar los datos de este dispositivo por la versión en Supabase? Verifica primero que el respaldo quedó guardado.'))return;
  }else if(local.snapshot.profile&&!confirm('¿Cargar los datos guardados en Supabase? Se cerrarán las pantallas de edición abiertas.'))return;
  await applyCloudSnapshot(remote.snapshot,owner,Number(remote.revision),local.revision);
  synced(remote);location.reload();
 }catch(e){paint('No se recuperaron datos: '+e.message);}
 finally{busy=false;}
}
async function authenticate(email,password,signup){
 if(busy||authWorking||transitioning)return;
 if(signup&&Date.now()<nextSignupAt){paint('Ya solicitaste un correo. Revisa la bandeja de entrada y spam; no crees otra cuenta.');return;}
 busy=true;authControls(true);paint(signup?'Creando tu cuenta privada…':'Verificando tu acceso…');
 try{
  if(signup){nextSignupAt=Date.now()+60000;const s=await request('/auth/v1/signup?redirect_to='+encodeURIComponent(AUTH_RETURN),{method:'POST',body:{email,password}});if(!s?.access_token){paint('Revisa tu correo y abre el enlace de verificación. Regresa aquí e inicia sesión con el mismo correo y contraseña. No necesitas crear otra cuenta.');return;}useSession(s);}
  else useSession(await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}}));
  const local=await cloudSnapshot();
  if(local.binding&&local.binding.owner!==session.user.id){saveSession(null);paint('Este dispositivo pertenece a otra cuenta. No se movieron datos.');return;}
  paint('Sesión iniciada. Consultando Supabase…');
 }catch(e){paint(authError(e));}
 finally{busy=false;authControls(false);if(session){await hydrate();if(ready)sync();}}
}
async function resendConfirmation(){
 if(authWorking||busy||transitioning||session)return;
 const email=el('novaLoginPanel').querySelector('[name=email]');
 if(!email.reportValidity())return;
 if(Date.now()<nextSignupAt){paint('Ya solicitaste un correo. Revisa tu bandeja de entrada y spam. Espera un minuto para reenviar.');return;}
 const button=el('novaResendConfirmation');
 authControls(true);button.disabled=true;nextSignupAt=Date.now()+60000;
 try{await request('/auth/v1/resend?redirect_to='+encodeURIComponent(AUTH_RETURN),{method:'POST',body:{type:'signup',email:email.value.trim()}});paint('Si tu cuenta está pendiente de confirmación y el envío está habilitado, recibirás un enlace nuevo. Revisa tu correo y spam.');}
 catch(e){paint(authError(e));}
 finally{authControls(false);button.disabled=false;}
}
async function requestReset(){
 if(authWorking||busy||transitioning)return;
 const email=el('novaLoginPanel').querySelector('[name=email]');
 if(!email.reportValidity())return;
 if(Date.now()<nextRecoveryAt){paint('Ya solicitaste un enlace. Revisa el correo y la carpeta de spam.');return;}
 authControls(true);el('novaForgotPassword').disabled=true;nextRecoveryAt=Date.now()+60000;
 try{await request('/auth/v1/recover?redirect_to='+encodeURIComponent(AUTH_RETURN),{method:'POST',body:{email:email.value.trim()}});paint('Si tu cuenta existe y está habilitada, recibirás un correo para crear una contraseña nueva. Abre el enlace en este navegador.');}
 catch(e){paint(authError(e));}
 finally{authControls(false);el('novaForgotPassword').disabled=false;}
}
async function resetPassword(e){
 e.preventDefault();if(!recoveryToken||authWorking)return;
 const pass=el('novaNewPassword').value,repeat=el('novaRepeatPassword').value;
 if(pass.length<8||pass!==repeat){message('Las contraseñas deben coincidir y tener al menos ocho caracteres.');return;}
 authControls(true);el('novaResetForm').querySelector('button').disabled=true;
 try{await request('/auth/v1/user',{method:'PUT',access:recoveryToken,body:{password:pass}});await request('/auth/v1/logout',{method:'POST',access:recoveryToken}).catch(()=>{});recoveryToken=null;saveSession(null);el('novaResetForm').reset();view('login');message('Contraseña actualizada. Inicia sesión con tu nueva contraseña.');paint('Accede a tu cuenta.');}
 catch(e){message(authError(e));}
 finally{authControls(false);el('novaResetForm').querySelector('button').disabled=false;}
}
async function listBackups(){
 const box=el('novaBackupList');box.textContent='Consultando…';
 try{if(!cloudReady())throw Error('Inicia sesión y vincula tu empresa.');
 const user=session.user.id;
 const data=await request('/rest/v1/nova_workspace_backups?owner_id=eq.'+encodeURIComponent(user)+'&select=backup_day,revision,created_at&order=backup_day.desc',{access:await access()});
 box.replaceChildren();
 if(!data?.length){box.textContent='Todavía no hay respaldos registrados.';return;}
 for(const row of data){const b=document.createElement('button');b.type='button';b.textContent='Descargar copia · '+row.backup_day+' · v'+row.revision;b.addEventListener('click',async()=>{
  b.disabled=true;
  try{const found=await request('/rest/v1/nova_workspace_backups?owner_id=eq.'+encodeURIComponent(user)+'&backup_day=eq.'+encodeURIComponent(row.backup_day)+'&select=snapshot',{access:await access()});
  if(!found?.[0]?.snapshot)throw Error('No se encontró la copia.');
  const blob=new Blob([JSON.stringify(found[0].snapshot,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='nova-respaldo-'+row.backup_day+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
  }catch(e){box.append(document.createTextNode(e.message));}finally{b.disabled=false;}
 });box.append(b);}
 }catch(e){box.textContent=e.message;}
}
async function logout(){if(busy||transitioning)return;if(!confirm('¿Cerrar sesión? Los registros locales se conservarán.'))return;stopped=true;ready=false;try{if(session)await request('/auth/v1/logout',{method:'POST',access:await access()});}catch{}finally{saveSession(null);location.reload();}}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>sync(),500);}
export function setupCloud(onOpen){openApp=onOpen;view('login');
 // The email confirmation flow may redirect with a session in the URL. Never
 // retain raw tokens in the URL or accept a session without explicit login.
 const fragment=new URLSearchParams(location.hash.slice(1));
 const returned=fragment.has('access_token')||fragment.has('error')||fragment.has('error_code');
 const returnedError=fragment.has('error')||fragment.has('error_code');
 const recovery=fragment.get('type')==='recovery'&&!returnedError&&fragment.get('access_token');
 if(recovery){recoveryToken=recovery;saveSession(null);}
 if(returned)history.replaceState(null,'',location.pathname+location.search);
 document.querySelectorAll('[data-cloud-form]').forEach(form=>{
  form.addEventListener('submit',e=>{e.preventDefault();const email=form.querySelector('[name=email]').value.trim(),password=form.querySelector('[name=password]').value,signup=e.submitter?.dataset.mode==='signup';if(password.length<8){paint('La contraseña debe tener al menos 8 caracteres.');return;}form.querySelector('[name=password]').value='';authenticate(email,password,signup);});
 });
 document.querySelectorAll('[data-cloud-push]').forEach(b=>b.addEventListener('click',()=>sync({initial:true})));
 document.querySelectorAll('[data-cloud-pull]').forEach(b=>b.addEventListener('click',recover));
 document.querySelectorAll('[data-cloud-logout],[data-cloud-exit]').forEach(b=>b.addEventListener('click',logout));
 el('novaMigrateLocal').addEventListener('click',async()=>{if(!confirm('¿Vincular los datos de este dispositivo a tu cuenta NOVA? Se conservarán los registros y enlaces anteriores.'))return;try{await finishOnboarding(true);}catch(e){message(e.message);}});
 el('novaMigrateRemote').addEventListener('click',recover);el('novaRetryAccount').addEventListener('click',hydrate);
 el('novaShowPassword')?.addEventListener('click',()=>{const field=el('novaLoginPassword'),button=el('novaShowPassword');const visible=field.type==='password';field.type=visible?'text':'password';button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',visible?'Ocultar contraseña':'Mostrar contraseña');});
 el('novaResendConfirmation').addEventListener('click',resendConfirmation);el('novaForgotPassword').addEventListener('click',requestReset);el('novaResetForm').addEventListener('submit',resetPassword);el('novaCancelReset').addEventListener('click',()=>{recoveryToken=null;el('novaResetForm').reset();view('login');message('');});el('novaLoadBackups').addEventListener('click',listBackups);el('novaBillingRetry')?.addEventListener('click',refreshBilling);window.addEventListener('online',refreshBilling);window.addEventListener('focus',()=>{if(ready)refreshBilling();});
 window.addEventListener('nova-local-change',()=>{if(ready)paint(navigator.onLine?'Guardando cambios en Supabase…':'Sin internet · guardado local.');schedule();});window.addEventListener('online',schedule);window.addEventListener('offline',()=>paint('Sin internet · guardado local.'));
 window.addEventListener('focus',schedule);document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});setInterval(()=>{if(!document.hidden)sync();},30000);
 if(recoveryToken){view('reset');message('Introduce tu contraseña nueva.');return;}
 paint(session?'Consultando Supabase…':returned?(returnedError?'El enlace de verificación no pudo completarse. Regresa a tu correo o inicia sesión si ya lo verificaste.':'Regresaste de la verificación. Inicia sesión con tu correo y contraseña.'):'');if(session)hydrate();
}
