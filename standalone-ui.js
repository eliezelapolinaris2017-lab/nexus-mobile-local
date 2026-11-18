import {getProfile,saveProfile,exportWorkspace,restoreWorkspace,onSnapshot,addDoc,updateDoc,serverTimestamp} from './local-db.js';
export function setupStandalone({$,state,COLS,colRef,docRef,clientBy,today,switchTab,ensureLines,renderInvoiceLines,renderAll,renderSummary,calculateMobilePrice,setSync,showMobileNotice}){
let unsub=[];
function form(prefix){return '<label>Nombre del negocio<input id="'+prefix+'Name" required maxlength="100" autocomplete="organization"></label><label>Teléfono<input id="'+prefix+'Phone" type="tel"></label><label>Correo<input id="'+prefix+'Email" type="email"></label><label>Dirección<input id="'+prefix+'Address"></label><label>Sitio web<input id="'+prefix+'Web" type="url"></label><label>IVU %<input id="'+prefix+'Tax" type="number" min="0" max="100" step="0.01" value="11.5" required></label><label>Logo (PNG o JPEG, hasta 1 MB)<input id="'+prefix+'Logo" type="file" accept="image/png,image/jpeg"></label><button type="submit" class="primary">Guardar configuración</button>';}
async function readLogo(file){if(!file)return null;if(!['image/png','image/jpeg'].includes(file.type)||file.size>1024*1024)throw new Error('Selecciona PNG o JPEG de hasta 1 MB.');return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});}
async function readProfile(prefix){const tax=Number($(prefix+'Tax').value),businessName=$(prefix+'Name').value.trim();if(!businessName||!Number.isFinite(tax)||tax<0||tax>100)throw new Error('Revisa el nombre y el IVU.');const p={businessName,tax,phone:$(prefix+'Phone').value.trim(),email:$(prefix+'Email').value.trim(),address:$(prefix+'Address').value.trim(),web:$(prefix+'Web').value.trim()};const logo=await readLogo($(prefix+'Logo').files[0]);if(logo)Object.assign(p,{logo,logoPdf:logo,logoDashboard:logo});return p;}
function fillProfile(){const p=state.profile||{};for(const [key,field] of Object.entries({Name:'businessName',Phone:'phone',Email:'email',Address:'address',Web:'web',Tax:'tax'}))$('localSettings'+key).value=p[field]??(key==='Tax'?11.5:'');}
function refreshClients(){const select=$('localServiceClient');const prev=select.value;select.replaceChildren(new Option('Seleccionar cliente',''),...state.clients.map(c=>new Option(c.name||'Cliente',c.id)));select.value=prev;}
function revealError(e){$('mobileAuth').classList.remove('hidden');$('mobileApp').classList.add('hidden');$('mobileAuthMsg').textContent='No se pudo iniciar: '+(e?.message||e);$('novaRetry').hidden=false;console.error('Nexus startup:',e);}
async function start(){
 const p=await getProfile();
 if(!p){$('mobileAuth').classList.remove('hidden');$('mobileApp').classList.add('hidden');return;}
 state.profile=p;$('mobileBusiness').textContent=p.businessName;$('mCalcTax').value=String(p.tax??11.5);calculateMobilePrice();fillProfile();ensureLines();renderInvoiceLines();
 unsub.forEach(fn=>fn());
 unsub=COLS.map(c=>onSnapshot(colRef(c),snap=>{state[c]=snap.docs.map(d=>({...d.data(),id:d.id}));renderAll();refreshClients();setSync('Local · guardado');},e=>{setSync('Error local');showMobileNotice(e.message,'danger');console.error('Local snapshot',e);}));
 renderAll();$('mobileAuth').classList.add('hidden');$('mobileApp').classList.remove('hidden');
 if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
}
const setup=$('mobileAuthForm');setup.innerHTML=form('localSetup');$('mobileAuthMsg').textContent='Abriendo almacenamiento…';
const setupBtn=setup.querySelector('button[type=submit]');setupBtn.disabled=true;
setup.addEventListener('input',()=>{setup.dataset.dirty='true';});
setup.addEventListener('submit',async e=>{
 e.preventDefault();if(setupBtn.disabled)return;setupBtn.disabled=true;setupBtn.textContent='Guardando…';
 try{const p=await readProfile('localSetup');await saveProfile(p);await start();setup.dataset.dirty='false';$('mobileAuthMsg').textContent='';}
 catch(err){revealError(err);}
 finally{setupBtn.disabled=false;setupBtn.textContent='Guardar configuración';}
});
const settings=$('localSettingsForm');settings.innerHTML=form('localSettings');settings.addEventListener('submit',async e=>{e.preventDefault();try{await saveProfile(await readProfile('localSettings'));state.profile=await getProfile();$('mobileBusiness').textContent=state.profile.businessName;$('mCalcTax').value=String(state.profile.tax);calculateMobilePrice();renderSummary();showMobileNotice('Configuración guardada','ok');}catch(err){showMobileNotice(err.message,'danger');}});
$('mobileLogout').addEventListener('click',()=>switchTab('mSync'));
$('localExport').addEventListener('click',async()=>{try{const backup=await exportWorkspace();const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='nexus-local-respaldo-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}catch(e){showMobileNotice(e.message,'danger');}});
$('localImport').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(!confirm('El respaldo reemplazará los datos locales. ¿Continuar?'))return;if(file.size>100*1024*1024)throw new Error('Respaldo demasiado grande');await restoreWorkspace(JSON.parse(await file.text()));location.reload();}catch(e){showMobileNotice(e.message,'danger');}finally{$('localImport').value='';}});
$('localServiceDate').value=today();$('localServiceForm').addEventListener('submit',async e=>{e.preventDefault();const c=clientBy($('localServiceClient').value),title=$('localServiceTitle').value.trim();if(!c.id||!title)return;try{await addDoc(colRef('services'),{clientId:c.id,clientName:c.name,title,date:$('localServiceDate').value,time:$('localServiceTime').value,note:$('localServiceNote').value,status:'Programado',createdAt:serverTimestamp()});e.target.reset();$('localServiceDate').value=today();showMobileNotice('Trabajo guardado','ok');}catch(err){showMobileNotice(err.message,'danger');}});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-local-complete]');if(!b)return;if(!confirm('¿Marcar trabajo completado?'))return;try{await updateDoc(docRef('services',b.dataset.localComplete),{status:'Completado',updatedAt:serverTimestamp()});}catch(err){showMobileNotice(err.message,'danger');}});
start().then(()=>{$('mobileAuthMsg').textContent='';setupBtn.disabled=false;}).catch(e=>{revealError(e);setupBtn.disabled=false;});
}
