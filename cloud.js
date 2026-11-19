// Private NOVA cloud workspace. Public API key only; data requires Supabase Auth.
import {cloudSnapshot,acknowledgeCloud,applyCloudSnapshot} from './local-db.js';
const BASE='https://cgpfpxueqciefclonghz.supabase.co';
const API='sb_publishable_C80PjdtDeDfIT2z5EnUh5g_CiOUlUoG';
const SESSION='nova-cloud-session-v1';
const LEGACY='nexus-local-confirmations-config-v1';
export const PROJECT_REF='cgpfpxueqciefclonghz';
let ready=false,openApp=null,transitioning=false;
export const cloudReady=()=>ready&&!!session;
export async function confirmationRequest(body){return request('/functions/v1/nova-confirmations',{method:'POST',access:await access(),body});}
function legacyKey(){try{const c=JSON.parse(localStorage.getItem(LEGACY)||'null');return c?.ref===PROJECT_REF&&/^[a-f0-9]{64}$/.test(c.key)?c.key:null;}catch{return null;}}
async function activateConfirmations(importLegacy=false){const key=importLegacy?legacyKey():null;await confirmationRequest({action:'provision',...(key?{legacyKey:key}:{})});if(key)localStorage.removeItem(LEGACY);}
const el=id=>document.getElementById(id);
function view(stage){el('mobileAuth').classList.toggle('hidden',stage==='app');el('mobileApp').classList.add('hidden');el('novaLoginPanel').hidden=stage!=='login';el('novaOnboarding').hidden=stage!=='onboarding';el('novaMigration').hidden=stage!=='migration';el('novaAuthTitle').textContent=stage==='onboarding'?'Configura tu empresa.':stage==='migration'?'Vincula tu negocio.':'Bienvenido a NOVA.';el('novaAuthSubtitle').textContent=stage==='onboarding'?'PASO 2 DE 2 · TU EMPRESA':stage==='migration'?'CONSERVA TUS DATOS':'PASO 1 DE 2 · TU CUENTA';}
function message(s){el('mobileAuthMsg').textContent=s||'';}
async function enter(){await openApp();ready=true;el('mobileAuth').classList.add('hidden');el('mobileApp').classList.remove('hidden');window.dispatchEvent(new Event('nova-cloud-ready'));}
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
 if(existing){if(!local.binding||local.binding.owner!==owner)throw Error('Ya existe una empresa en la nube. Recupérala en lugar de reemplazarla.');}
 else{await activateConfirmations(importLegacy);const result=await request('/rest/v1/nova_workspaces?select=revision,updated_at',{method:'POST',access:await access(),prefer:'return=representation',body:{owner_id:owner,snapshot:local.snapshot}});if(!result?.[0])throw Error('No se pudo verificar la primera copia.');await acknowledgeCloud(owner,0,Number(result[0].revision),local.revision);synced(result[0]);}
 await activateConfirmations(importLegacy);await enter();message('');
 }finally{transitioning=false;}
}
let session=null,busy=false,timer=null,refreshPromise=null,stopped=false;
try{session=JSON.parse(sessionStorage.getItem(SESSION)||'null');}catch{}
function saveSession(s){session=s;if(!s)ready=false;try{if(s)sessionStorage.setItem(SESSION,JSON.stringify(s));else sessionStorage.removeItem(SESSION);}catch{}}
async function request(path,{method='GET',body,access,prefer}={}){
 const headers={apikey:API,'Content-Type':'application/json'};
 if(access)headers.Authorization='Bearer '+access;
 if(prefer)headers.Prefer=prefer;
 const r=await fetch(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(20000),referrerPolicy:'no-referrer'});
 const v=await r.json().catch(()=>null);
 if(!r.ok){const e=Error(v?.msg||v?.message||v?.error_description||v?.error||'No se pudo conectar a Supabase.');e.status=r.status;throw e;}
 return v;
}
function useSession(s){if(!s?.access_token||!s?.refresh_token||!s?.user?.id)throw Error('Verifica tu correo e inicia sesión.');saveSession({access_token:s.access_token,refresh_token:s.refresh_token,user:{id:s.user.id,email:s.user.email},expires_at:s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600)});}
async function access(){
 if(!session)throw Error('Inicia sesión en NOVA.');
 if(session.expires_at>Date.now()/1000+90)return session.access_token;
 if(!refreshPromise){refreshPromise=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}}).then(s=>{useSession(s);return session.access_token;}).catch(e=>{if(e.status===400||e.status===401){saveSession(null);location.reload();}throw e;}).finally(()=>refreshPromise=null);}
 return refreshPromise;
}
function paint(msg){document.querySelectorAll('[data-cloud-status]').forEach(e=>e.textContent=msg);document.querySelectorAll('[data-cloud-login]').forEach(e=>e.hidden=!!session);document.querySelectorAll('[data-cloud-actions]').forEach(e=>e.hidden=!session);}
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
 if(busy)return;busy=true;
 try{
  if(signup){const s=await request('/auth/v1/signup',{method:'POST',body:{email,password}});if(!s?.access_token){paint('Cuenta solicitada. Busca el correo de verificación y después inicia sesión.');return;}useSession(s);}
  else useSession(await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}}));
  const local=await cloudSnapshot();
  if(local.binding&&local.binding.owner!==session.user.id){saveSession(null);paint('Este dispositivo pertenece a otra cuenta. No se movieron datos.');return;}
  paint('Sesión iniciada. Consultando Supabase…');
 }catch(e){paint('No se pudo iniciar sesión: '+e.message);}
 finally{busy=false;if(session){await hydrate();if(ready)sync();}}
}
async function logout(){if(busy||transitioning)return;if(!confirm('¿Cerrar sesión? Los registros locales se conservarán.'))return;stopped=true;ready=false;try{if(session)await request('/auth/v1/logout',{method:'POST',access:await access()});}catch{}finally{saveSession(null);location.reload();}}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>sync(),1600);}
export function setupCloud(onOpen){openApp=onOpen;view('login');
 document.querySelectorAll('[data-cloud-form]').forEach(form=>{
  form.addEventListener('submit',e=>{e.preventDefault();const email=form.querySelector('[name=email]').value.trim(),password=form.querySelector('[name=password]').value,signup=e.submitter?.dataset.mode==='signup';if(password.length<8){paint('La contraseña debe tener al menos 8 caracteres.');return;}form.querySelector('[name=password]').value='';authenticate(email,password,signup);});
 });
 document.querySelectorAll('[data-cloud-push]').forEach(b=>b.addEventListener('click',()=>sync({initial:true})));
 document.querySelectorAll('[data-cloud-pull]').forEach(b=>b.addEventListener('click',recover));
 document.querySelectorAll('[data-cloud-logout],[data-cloud-exit]').forEach(b=>b.addEventListener('click',logout));
 el('novaMigrateLocal').addEventListener('click',async()=>{if(!confirm('¿Vincular los datos de este dispositivo a tu cuenta NOVA? Se conservarán los registros y enlaces anteriores.'))return;try{await finishOnboarding(true);}catch(e){message(e.message);}});
 el('novaMigrateRemote').addEventListener('click',recover);el('novaRetryAccount').addEventListener('click',hydrate);
 window.addEventListener('nova-local-change',schedule);window.addEventListener('online',schedule);window.addEventListener('offline',()=>paint('Sin internet · guardado local.'));
 window.addEventListener('focus',schedule);document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});setInterval(()=>{if(!document.hidden)sync();},30000);
 paint(session?'Consultando Supabase…':'Inicia sesión o crea tu cuenta privada.');if(session)hydrate();
}
