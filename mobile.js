import { searchClients, normalizeClientSearch } from './client-search.js';
import { createViewMemory } from './ui-context.js';
import { collection,doc,addDoc,updateDoc,deleteDoc,onSnapshot,serverTimestamp,nextInvoiceNumber,createInvoiceWithPayment,settleInvoice } from './local-db.js';
import { setupStandalone } from './standalone-ui.js';
import { createAgenda } from './agenda.js';
import { createAlertCenter } from './alerts.js';
import { createFinance } from './finance.js';
import { renderInvoicePdf } from './invoice-pdf.js';
const APP_VERSION = 'NOVA 3.0.3';
let deferredInstallPrompt = null;
let updateWaiting = null;
let currentFilter = 'all';
let currentDocId = null;
let currentDocSnapshot = null;
let invoiceLines = [];
let lastCreatedInvoiceId = null;
let editingInvoiceId = null;
let invoiceSaving = false;
let mobileInvoiceListLimit=40;
let invoiceEditReturnView=null;

const db = null;
const $ = id => document.getElementById(id);
const money = n => Number(n || 0).toLocaleString('es-PR', { style: 'currency', currency: 'USD' });
const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
const localDate=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const today = () => localDate(new Date());
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + Number(n || 0)); return localDate(d); };
const plusMonths = (date, months = 6) => { const d = new Date((date || today()) + 'T12:00:00'); d.setMonth(d.getMonth() + Number(months || 6)); return localDate(d); };

let unsub = [];
let state = { profile:null, clients:[], services:[], quotes:[], followups:[], invoices:[], payments:[], assets:[], contracts:[], expenses:[], suppliers:[], purchases:[], purchasePayments:[], inventory:[], stockUsage:[] };
const COLS = ['clients', 'services', 'quotes', 'followups', 'invoices', 'payments', 'assets', 'contracts','expenses','suppliers','purchases','purchasePayments','inventory','stockUsage'];
function uid(){ return 'local'; }
function colRef(c){ return collection(db, 'users', uid(), c); }
function docRef(c, id){ return doc(db, 'users', uid(), c, id); }
function clientBy(id){ return state.clients.find(c => c.id === id) || {}; }
function taxRate(){ const inv=state.invoices.find(i=>i.id===editingInvoiceId);return Number(inv?.taxPercent ?? state.profile?.tax ?? 11.5)/100; }
function invoicePaid(inv){ return state.payments.filter(p => p.invoiceId === inv.id).reduce((a, p) => a + Number(p.amount || 0), 0); }
function invoicePaymentMethods(inv){ return [...new Set(state.payments.filter(p => p.invoiceId === inv.id).map(p => String(p.method || '').trim()).filter(Boolean))]; }
function invoicePaymentTerms(inv, fallback='Pago según acuerdo.'){ const methods=invoicePaymentMethods(inv); if(!methods.length) return fallback; return `${methods.length>1?'Métodos de pago':'Método de pago'}: ${methods.join(', ')}.`; }
function invoiceBalance(inv){ if(['Cancelada','Borrador'].includes(inv.status))return 0;return Math.max(0, Math.round((Number(inv.total || 0) - invoicePaid(inv))*100)/100); }
function invoiceStatus(inv){ const bal = invoiceBalance(inv), paid = invoicePaid(inv); if(String(inv.status||'') === 'Cancelada') return 'Cancelada'; if(String(inv.status||'') === 'Borrador') return 'Borrador'; if(bal <= 0 || String(inv.status||'') === 'Pagada') return 'Pagada'; if(inv.dueDate && inv.dueDate < today()) return 'Vencida'; return paid > 0 ? 'Parcial' : 'Pendiente'; }
function statusBadge(status){ const s = String(status || 'Pendiente'); const cls = s === 'Pagada' || s === 'Completado' ? 'ok' : (s === 'Vencida' || s === 'Urgente' || s === 'Vencido' ? 'danger' : (s === 'Próximo' || s === 'Parcial' || s === 'Pendiente' ? 'warn' : '')); return `<span class="badge ${cls}">${esc(s)}</span>`; }
function sorted(arr, key='date'){ return [...(arr || [])].sort((a,b) => String(b[key] || '').localeCompare(String(a[key] || ''))); }
function phoneLink(c){ const raw = String(c.phone || c.whatsapp || '').replace(/\D/g, ''); if(!raw) return ''; const normalized = raw.length === 10 ? '1' + raw : raw.replace(/^1?/, '1'); return `https://wa.me/${normalized}`; }
function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function isIOS(){ return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isIOSPWA(){ return isIOS() && isStandalone(); }
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
function setSync(text){ const el = $('mobileSync'); if(el&&!el.dataset.cloudMode) el.textContent = text; }
function showMobileNotice(message, type='info'){
  let box = document.querySelector('.mobile-notice');
  if(!box){ box = document.createElement('div'); box.className = 'mobile-notice'; document.body.appendChild(box); }
  box.className = 'mobile-notice ' + type;
  box.textContent = message;
  clearTimeout(showMobileNotice._t);
  showMobileNotice._t = setTimeout(() => { box?.remove(); }, 4200);
}
function firebaseMessage(err){return err?.message||'No se pudo guardar localmente.';}
function newLine(description='', qty=1, price=0, discount=0, taxable=true){ return { id:'ln_' + Date.now() + '_' + Math.random().toString(16).slice(2), description, qty:Number(qty||1), price:Number(price||0), discount:Number(discount||0), taxable }; }
function ensureLines(){ if(!invoiceLines.length) invoiceLines = [newLine('', 1, 0)]; }
function isDiscountLine(l){ return Number(l.price) === 0 && l.taxable === false; }
function lineNet(l){ if(isDiscountLine(l)) return -Math.max(0, Number(l.discount)||0); return Math.max(0, (Number(l.qty||0) * Number(l.price||0)) - Number(l.discount||0)); }
function invoiceCalc(){const round=x=>Math.round((x+Number.EPSILON)*100)/100;const subtotal=round(invoiceLines.reduce((a,l)=>a+Number(l.qty||0)*Number(l.price||0),0));const discount=round(invoiceLines.reduce((a,l)=>a+Number(l.discount||0),0));const taxableBase=invoiceLines.filter(l=>l.taxable!==false).reduce((a,l)=>a+lineNet(l),0);const ivu=round(taxableBase*taxRate());return {subtotal,discount,ivu,total:round(Math.max(0,subtotal-discount+ivu))};}
function cleanPayload(obj){
  return Object.fromEntries(Object.entries(obj).filter(([,v]) => v !== undefined));
}

function setupPwaInstall(){
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; renderSyncDetails(); });
  window.addEventListener('online', () => { setSync('Local · disponible'); renderSyncDetails(); });
  window.addEventListener('offline', () => { setSync('Local · sin internet'); renderSyncDetails(); });
  if('serviceWorker' in navigator){
    navigator.serviceWorker.ready.then(reg => {
      updateWaiting = reg.waiting || null;
      if(updateWaiting) showUpdateToast();
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if(!worker) return;
        worker.addEventListener('statechange', () => { if(worker.state === 'installed' && navigator.serviceWorker.controller){ updateWaiting = worker; showUpdateToast(); } });
      });
    }).catch(()=>{});
    // El arranque inicial no debe recargar la página ni interrumpir el formulario.
    // La actualización de un controlador previo se gestiona en index.html.
  }
}
function showUpdateToast(){
  if(document.querySelector('.update-toast')) return;
  const box = document.createElement('div');
  box.className = 'update-toast';
  box.innerHTML = '<span>Nueva versión móvil disponible.</span><button type="button" id="applyUpdateBtn">Actualizar</button>';
  document.body.appendChild(box);
}
function applyWaitingUpdate(){ if(updateWaiting) updateWaiting.postMessage({ type:'SKIP_WAITING' }); else location.reload(); }

const viewMemory=createViewMemory({getView:()=>document.querySelector('.mobile-view.active')?.id,getRoot:()=>document.querySelector('.mobile-view.active')});
let documentOrigin=null;
function switchTab(id){
  if (!document.getElementById(id)?.classList.contains('mobile-view')) return;
  viewMemory.save();
  const titles = {mDashboard:'Tu operación en la calle',mServices:'Trabajos pendientes',mInvoice:'Nueva factura',mInvoices:'Facturas',mClients:'Clientes',mFollowups:'Seguimientos',mHistory:'Historial',mSync:'Configuración y respaldo',mMore:'Más herramientas',mAgenda:'Agenda de trabajo',mReceivable:'Cuentas por cobrar',mCalculator:'Calculadora de precio',mAlerts:'Centro de notificaciones',mFinance:'Control financiero'};
  document.querySelector('.mobile-top p').textContent = titles[id] || 'Nexus Mobile Local';
  document.querySelectorAll('.mobile-tabs button').forEach(b => {
    const selected = b.dataset.tab === id || (b.dataset.tab === 'mMore' && ['mFollowups','mHistory','mSync','mAgenda','mReceivable','mCalculator','mAlerts','mFinance'].includes(id));
    b.setAttribute('aria-current', selected ? 'page' : 'false');
  });
  document.querySelectorAll('.mobile-view').forEach(v => v.classList.toggle('active', v.id === id));
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  viewMemory.recall();
  if(id==='mAgenda'){agenda.render();agenda.refreshConfirmations();}if(id==='mAlerts')alertCenter.render();if(id==='mFinance')finance.render();
}

document.addEventListener('click', async e => {
  const tab = e.target.closest('[data-tab]'); if(tab){ if(tab.dataset.tab==='mInvoice'&&editingInvoiceId)resetMobileInvoiceEditor();switchTab(tab.dataset.tab); return; }
  const invClient = e.target.closest('[data-new-invoice-client]'); if(invClient){ startInvoiceForClient(invClient.dataset.newInvoiceClient); return; }
  if(e.target.closest('#mClearClient')){ $('mClientForm')?.reset(); return; }
  const f = e.target.closest('[data-follow-filter]'); if(f){ currentFilter = f.dataset.followFilter; document.querySelectorAll('[data-follow-filter]').forEach(b => b.classList.toggle('active', b === f)); renderFollowups(); return; }
  const complete = e.target.closest('[data-complete-follow]'); if(complete){ await completeFollowup(complete.dataset.completeFollow); return; }
  const del = e.target.closest('[data-delete-follow]'); if(del && confirm('¿Borrar seguimiento?')){ await deleteDoc(docRef('followups', del.dataset.deleteFollow)); return; }
  if(e.target.closest('#mLoadMoreInvoices')){mobileInvoiceListLimit+=40;renderMobileInvoiceList();return;}
  const editInv=e.target.closest('[data-edit-invoice]');if(editInv){editMobileInvoice(editInv.dataset.editInvoice);return;}
  if(e.target.closest('#mCancelInvoiceEdit')){const back=invoiceEditReturnView;resetMobileInvoiceEditor();if(back)switchTab(back);return;}
  const shareInv = e.target.closest('[data-share-invoice]'); if(shareInv){ shareInvoice(shareInv.dataset.shareInvoice); return; }
  const pay = e.target.closest('[data-mark-paid]'); if(pay){ await markInvoicePaid(pay.dataset.markPaid); return; }
  const view = e.target.closest('[data-view-invoice]'); if(view){ openInvoiceDoc(view.dataset.viewInvoice); return; }
  const st = e.target.closest('[data-invoice-status]'); if(st){ setInvoiceStatus(st.dataset.invoiceStatus); return; }
  if(e.target.closest('#mAddDiscount')){ invoiceLines.push(newLine('Descuento',1,0,0,false)); renderInvoiceLines(); $('mInvoiceLines')?.lastElementChild?.scrollIntoView({block:'center',behavior:'smooth'}); return; }
  const add = e.target.closest('#mAddLine,#mAddLineTop'); if(add){ invoiceLines.push(newLine('',1,0)); renderInvoiceLines(); return; }
  const rm = e.target.closest('[data-remove-line]'); if(rm){ invoiceLines = invoiceLines.filter(l => l.id !== rm.dataset.removeLine); ensureLines(); renderInvoiceLines(); return; }
  const draft = e.target.closest('#mSaveDraft'); if(draft){ await saveInvoice('Borrador'); return; }
  const preview = e.target.closest('#mPreviewInvoice'); if(preview){ openInvoiceDoc(null, buildInvoicePreviewObject('Vista previa')); return; }
  const last = e.target.closest('#mViewLastDoc'); if(last){ if(lastCreatedInvoiceId) openInvoiceDoc(lastCreatedInvoiceId); else openInvoiceDoc(null, buildInvoicePreviewObject('Vista previa')); return; }
  if(e.target.id === 'mCloseDoc'){ closeDoc(); return; }
  if(e.target.id === 'mDownloadDoc'){try{const inv=currentInvoiceDocument();const name=invoiceFilename(inv);downloadPdfFile(await buildInvoicePdfFile(inv,name),name);}catch(err){showMobileNotice('No se pudo generar PDF: '+err.message,'danger');}return;}
  if(e.target.id === 'mPrintDoc'){ printCurrentDoc(); return; }
  if(e.target.id === 'mShareDoc'){ shareCurrentDoc(); return; }
  if(e.target.id === 'applyUpdateBtn'){ applyWaitingUpdate(); return; }
});

document.addEventListener('input', e => {
  const row = e.target.closest('[data-line-row]');
  if(row){ updateLineFromRow(row); renderSummary(); return; }
});

document.addEventListener('change', e => {
  const row = e.target.closest('[data-line-row]');
  if(row){ updateLineFromRow(row); renderSummary(); return; }
});

$('mForceReload')?.addEventListener('click', async () => {
  if('serviceWorker' in navigator){ const reg = await navigator.serviceWorker.getRegistration().catch(()=>null); await reg?.update?.().catch(()=>{}); if(reg?.waiting){ updateWaiting = reg.waiting; applyWaitingUpdate(); return; } }
  location.reload();
});
$('mClientSearch')?.addEventListener('input', renderClients);
$('mClientForm')?.addEventListener('submit', saveMobileClient);
$('mHistorySearch')?.addEventListener('input', renderHistory);
$('mRefreshInvoices')?.addEventListener('click', () => renderAll());
$('mInstallBtn')?.addEventListener('click', async () => {
  if(deferredInstallPrompt){ deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice.catch(()=>{}); deferredInstallPrompt = null; renderSyncDetails(); return; }
  alert('En iPhone/iPad: abre Safari, toca Compartir y selecciona Añadir a pantalla de inicio.');
});
$('mInvoiceForm')?.addEventListener('submit', async e => { e.preventDefault(); await saveInvoice($('mInvStatus')?.value || 'Pendiente'); });
$('mFollowupForm')?.addEventListener('submit', saveMobileFollowup);

async function saveMobileFollowup(e){
  e.preventDefault();
  const form = e.currentTarget || e.target;
  const btn = form.querySelector('button[type="submit"]');
  const clientId = $('mFollowClient')?.value || '';
  const c = clientBy(clientId);
  if(!c.id){ showMobileNotice('Selecciona un cliente antes de guardar el seguimiento.', 'warn'); alert('Selecciona cliente.'); return; }
  const title = String($('mFollowTitle')?.value || '').trim();
  if(!title){ showMobileNotice('Escribe el asunto del seguimiento.', 'warn'); return; }
  const dueDate = $('mFollowDue')?.value || plusMonths(today(), 6);
  const intervalMonths = Math.max(0, Number($('mFollowInterval')?.value || 6));
  const payload = cleanPayload({
    clientId:c.id,
    clientName:c.name || '',
    clientPhone:c.phone || c.whatsapp || '',
    type:$('mFollowType')?.value || 'Mantenimiento',
    title,
    date:dueDate,
    dueDate,
    nextDate:dueDate,
    intervalMonths,
    status:'Programado',
    priority:$('mFollowPriority')?.value || 'Normal',
    channel:'WhatsApp',
    note:'',
    sourceType:'mobile',
    sourceId:'',
    createdByUid:uid(),
    createdAt:serverTimestamp(),
    updatedAt:serverTimestamp()
  });
  try{
    if(btn){ btn.disabled = true; btn.textContent = 'Guardando…'; }
    const ref = await addDoc(colRef('followups'), payload);
    state.followups = [{ id:ref.id, ...payload }, ...state.followups.filter(x => x.id !== ref.id)];
    form.reset();
    renderSelects();
    renderFollowups();
    renderDashboard();
    renderHistory();
    renderSyncDetails();
    setSync('Seguimiento guardado · sincronizando');
    showMobileNotice('Seguimiento guardado correctamente.', 'ok');
  }catch(err){
    console.error('Error guardando seguimiento móvil:', err);
    setSync('Error al guardar seguimiento');
    showMobileNotice(firebaseMessage(err), 'danger');
    alert(firebaseMessage(err));
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Guardar seguimiento'; }
  }
}


setupPwaInstall();
function renderAll(){return viewMemory.preserve(()=>renderAllContent());}
function renderAllContent(){ renderServices(); renderSelects(); renderDashboard(); renderInvoices(); renderFollowups(); renderClients(); renderHistory(); renderSyncDetails(); renderSummary(); renderMobileTools(); alertCenter.render(); finance.render(); }
function renderSelects(){
  const opts = state.clients.map(c => `<option value="${esc(c.id)}">${esc(c.name || 'Cliente')}</option>`).join('');
  ['mInvClient', 'mFollowClient'].forEach(id => { const el = $(id); if(el){ const prev = el.value; el.innerHTML = `<option value="">Seleccionar cliente</option>${opts}`; if(prev) el.value = prev; } });
  for(const id of ['mInvClient','mFollowClient']){const selected=clientBy($(id)?.value);if(selected.id&&document.activeElement!==$(id+'Search'))$(id+'Search').value=selected.name||'';}
  if($('mInvDate') && !$('mInvDate').value) $('mInvDate').value = today();
  if($('mInvDue') && !$('mInvDue').value) $('mInvDue').value = plusDays(15);
  if($('mFollowDue') && !$('mFollowDue').value) $('mFollowDue').value = plusMonths(today(), 6);
}
async function saveMobileClient(e){
  e.preventDefault();
  const name = $('mClientName')?.value?.trim();
  if(!name) return alert('Escribe el nombre del cliente.');
  const tag = $('mClientTag')?.value || '';
  const payload = {
    name,
    phone: $('mClientPhone')?.value?.trim() || '',
    email: $('mClientEmail')?.value?.trim() || '',
    city: $('mClientCity')?.value?.trim() || '',
    address: $('mClientAddress')?.value?.trim() || '',
    tags: tag ? [tag] : [],
    notes: $('mClientNotes')?.value?.trim() || '',
    sourceType: 'mobile',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const button=e.target.querySelector('[type=submit]');if(button)button.disabled=true;
  try{
  const ref = await addDoc(colRef('clients'), payload);
  e.target.reset();
  setSync('Cliente guardado localmente');
  switchTab('mInvoice');
  if(!state.clients.some(c=>c.id===ref.id))state.clients.push({id:ref.id,...payload});
  renderSelects();
  if(agenda.acceptNewClient(ref.id)){$('mNewClientPanel').open=false;returnClientPicker=null;return;}
  const picker=returnClientPicker||'mInvClient';returnClientPicker=null;
  $('mNewClientPanel').open=false;
  if(picker==='mFollowClient'){switchTab('mFollowups');document.querySelector('.follow-create').open=true;}
  chooseMobileClient(picker,ref.id);
  $(picker+'Search').scrollIntoView({block:'center'});
  }catch(error){showMobileNotice('No se pudo guardar el cliente. '+firebaseMessage(error),'danger');}
  finally{if(button)button.disabled=false;}
}
function startInvoiceForClient(clientId){
  if(editingInvoiceId)resetMobileInvoiceEditor();
  switchTab('mInvoice');
  const sel = $('mInvClient');
  if(sel)chooseMobileClient('mInvClient',clientId||'');
  $('mInvClientSearch')?.scrollIntoView({block:'center'});
}
function setInvoiceStatus(status){
  $('mInvStatus').value = status;
  document.querySelectorAll('[data-invoice-status]').forEach(b => b.classList.toggle('active', b.dataset.invoiceStatus === status));
  renderSummary();
}
function renderInvoiceLines(){
  ensureLines();
  const box = $('mInvoiceLines'); if(!box) return;
  box.innerHTML = invoiceLines.map((l, idx) => `
    <div class="invoice-line" data-line-row="${esc(l.id)}">
      <div class="line-head"><span>${isDiscountLine(l) ? 'Descuento' : 'Línea ' + (idx + 1)}</span><button class="danger" data-remove-line="${esc(l.id)}" type="button">Borrar</button></div>
      <label>Descripción *<textarea data-line-field="description" rows="2" maxlength="220" placeholder="Ej. Mantenimiento preventivo 6 meses" required>${esc(l.description)}</textarea></label>
      ${isDiscountLine(l) ? `<label>Importe a descontar ($)<input data-line-field="discount" type="number" min="0" step="0.01" value="${esc(l.discount)}" /></label><small>Se resta del total. No lo añadas si el depósito ya está registrado como pago.</small>` : `<div class="three-col">
        <label>Cant.<input data-line-field="qty" type="number" min="1" step="1" value="${esc(l.qty)}" /></label>
        <label>Precio<input data-line-field="price" type="number" min="0" step="0.01" value="${esc(l.price)}" /></label>
        <label>Desc.<input data-line-field="discount" type="number" min="0" step="0.01" value="${esc(l.discount)}" /></label>
      </div>`}
      <div class="line-footer">${isDiscountLine(l) ? '<span>Se resta del total</span>' : `<label class="tax-check"><input data-line-field="taxable" type="checkbox" ${l.taxable === false ? '' : 'checked'} /> Aplica IVU</label>`}<b>${money(lineNet(l) + (l.taxable === false ? 0 : lineNet(l) * taxRate()))}</b></div>
    </div>`).join('');
  renderSummary();
}
function updateLineFromRow(row){
  const id = row.dataset.lineRow;
  const l = invoiceLines.find(x => x.id === id); if(!l) return;
  row.querySelectorAll('[data-line-field]').forEach(el => {
    const f = el.dataset.lineField;
    if(f === 'taxable') l[f] = el.checked;
    else if(['qty','price','discount'].includes(f)) l[f] = Number(el.value || 0);
    else l[f] = el.value;
  });
}
function renderSummary(){
  const c = invoiceCalc();
  if($('mInvSubtotal')) $('mInvSubtotal').textContent = money(c.subtotal);
  if($('mInvDiscountTotal')) $('mInvDiscountTotal').textContent = money(c.discount);
  if($('mInvTax')) $('mInvTax').textContent = money(c.ivu);
  if($('mInvTotal')) $('mInvTotal').textContent = money(c.total);
  const status = $('mInvStatus')?.value || 'Pendiente';
  if($('mInvStatusText')) $('mInvStatusText').textContent = status;
  if($('mInvBalanceText')) $('mInvBalanceText').textContent = `Balance: ${money(Math.max(0,c.total-(editingInvoiceId?invoicePaid(state.invoices.find(i=>i.id===editingInvoiceId)||{}):status==='Pagada'?c.total:0)))}`;
}
function renderDashboard(){
  const month = today().slice(0,7);
  const monthInvoices = state.invoices.filter(i => !['Cancelada','Borrador'].includes(i.status)&&String(i.date || '').startsWith(month));
  const monthPayments = state.payments.filter(p => String(p.date || '').startsWith(month));
  const invoiced = monthInvoices.reduce((a,i) => a + Number(i.total || 0), 0);
  const paid = monthPayments.reduce((a,p) => a + Number(p.amount || 0), 0);
  const receivable = state.invoices.reduce((a,i) => a + invoiceBalance(i), 0);
  const overdue = state.invoices.filter(i => invoiceStatus(i) === 'Vencida').reduce((a,i) => a + invoiceBalance(i), 0);
  $('mMonthNet').textContent = money(paid);
  $('novaDate').textContent = new Intl.DateTimeFormat('es-PR',{day:'numeric',month:'short'}).format(new Date());
  $('mBillingKpis').innerHTML = [['Facturado',invoiced,'invoice','mInvoices','↗'],['Cobrado',paid,'paid','mHistory','✓'],['Por cobrar',receivable,'wallet','mReceivable','＄'],['Vencido',overdue,'overdue','mReceivable','!']].map(x => `<button class="metric nova-metric metric-${x[2]}" data-tab="${x[3]}" type="button"><span class="metric-symbol" aria-hidden="true">${x[4]}</span><small>${x[0]}</small><b>${money(x[1])}</b></button>`).join('');
  renderInvoiceTypeKpis(monthInvoices);
  const critical = followupRows().filter(f => followStatus(f) !== 'Completado').slice(0,4);
  $('mCriticalFollowups').innerHTML = critical.length ? critical.map(followCard).join('') : '<div class="empty">Sin seguimientos críticos.</div>';
}
function renderInvoiceTypeKpis(monthInvoices){
  const target = $('mTypeKpis'); if(!target) return;
  const grouped = {};
  (monthInvoices || []).forEach(inv => { const key = inv.invoiceType || inv.type || 'Servicio'; if(!grouped[key]) grouped[key] = { count:0, total:0 }; grouped[key].count++; grouped[key].total += Number(inv.total || 0); });
  const preferred = ['Servicio','Mantenimiento','Instalación','Diagnóstico','Cotización','Reparación','Otro'];
  const rows = preferred.filter(k => grouped[k]).concat(Object.keys(grouped).filter(k => !preferred.includes(k)));
  target.innerHTML = rows.length ? rows.map(k => `<div class="type-chip"><small>${esc(k)} · ${grouped[k].count}</small><b>${money(grouped[k].total)}</b></div>`).join('') : '<div class="empty">Sin facturas este mes.</div>';
}
function mobileInvoiceCard(inv,{recent=false}={}){
  const c=clientBy(inv.clientId);
  return `<article class="row-card invoice-card-nova"><div class="top"><div class="nova-record-title"><span class="nova-record-icon record-invoice" aria-hidden="true">▤</span><div><h4>${esc(inv.number||'Factura')}</h4><p>${esc(inv.clientName||c.name||'Cliente')}</p></div></div>${statusBadge(invoiceStatus(inv))}</div><p>${esc(inv.date||'')} · ${esc(inv.serviceTitle||inv.invoiceType||'Servicio')}</p><div class="nova-invoice-amounts"><div><small>Total</small><b>${money(inv.total)}</b></div><div><small>Balance</small><b>${money(invoiceBalance(inv))}</b></div></div><div class="actions">${!recent&&inv.status!=='Cancelada'?`<button class="primary" data-edit-invoice="${esc(inv.id)}" type="button">Editar factura</button>`:''}<button data-view-invoice="${esc(inv.id)}" type="button">Ver documento</button>${!recent?`<button data-share-invoice="${esc(inv.id)}" type="button">Compartir</button>`:''}</div></article>`;
}
function renderInvoices(){
  const rows=sorted(state.invoices,'date').slice(0,5);
  $('mInvoiceList').innerHTML=rows.length?rows.map(inv=>mobileInvoiceCard(inv,{recent:true})).join(''):'<div class="empty">No hay facturas recientes.</div>';
  renderMobileInvoiceList();
}
function renderMobileInvoiceList(){
  const box=$('mAllInvoiceList');if(!box)return;
  const q=normalizeClientSearch($('mInvoicesSearch')?.value||''),status=$('mInvoicesStatus')?.value||'all';
  const rows=sorted(state.invoices,'date').filter(inv=>{
    const text=normalizeClientSearch([inv.number,inv.clientName,clientBy(inv.clientId).name,inv.serviceTitle,inv.invoiceType].join(' '));
    return q.split(/\s+/).filter(Boolean).every(token=>text.includes(token))&&(status==='all'||invoiceStatus(inv)===status);
  });
  $('mInvoicesCount').textContent=`${rows.length} factura${rows.length===1?'':'s'} · ${state.invoices.length} en total`;
  box.innerHTML=rows.length?rows.slice(0,mobileInvoiceListLimit).map(inv=>mobileInvoiceCard(inv)).join(''):'<div class="empty">No hay facturas para esta búsqueda.</div>';
  $('mLoadMoreInvoices').hidden=rows.length<=mobileInvoiceListLimit;
}
function followStatus(f){ if(String(f.status || '') === 'Completado') return 'Completado'; const d = String(f.dueDate || ''); if(d && d < today()) return 'Vencida'; if(d && d <= plusDays(14)) return 'Próximo'; return f.status || 'Programado'; }
function followupRows(){ return [...state.followups].sort((a,b) => String(a.dueDate || '').localeCompare(String(b.dueDate || ''))); }
function mobileIsQuoteFollowup(f){
  const type=String(f?.type||'').toLowerCase();
  const source=String(f?.sourceType||'').toLowerCase();
  const title=String(f?.title||'').toLowerCase();
  return type.includes('cotiz') || source==='quote' || title.includes('cotiz');
}
function maintenanceHistorySentence(f){
  const services=(state.services||[]).filter(s=>s.clientId===f.clientId && (!f.assetId||s.assetId===f.assetId) && ['Completado','Facturado'].includes(s.status) && /manten|limpieza/i.test([s.type,s.title,s.serviceType,s.serviceTitle,...(s.items||[]).map(i=>i.description||i.name||'')].join(' ')) && /^\d{4}-\d{2}-\d{2}$/.test(String(s.date||''))).sort((a,b)=>b.date.localeCompare(a.date));
  const source=(state.services||[]).find(s=>f.sourceType==='service'&&s.id===f.sourceId&&['Completado','Facturado'].includes(s.status)&&/manten|limpieza/i.test([s.type,s.title,s.serviceType,s.serviceTitle].join(' ')));
  const date=services[0]?.date||source?.date;
  if(!date) return '';
  const parsed=new Date(String(date).slice(0,10)+'T12:00:00');
  if(Number.isNaN(parsed.getTime())) return '';
  const month=parsed.toLocaleDateString('es-PR',{month:'long',year:'numeric'});
  return 'Según nuestro registro, el último mantenimiento de tu aire fue en '+month+'. ';
}
function mobileFollowupMessage(f,c){
  const name=String(f.clientName||c.name||'').trim();
  if(mobileIsQuoteFollowup(f)){
    const quote=state.quotes.find(q=>q.id===f.sourceId) || {};
    const number=String(f.quoteNumber||quote.number||'').trim();
    const reference=number ? ` ${number}` : '';
    return `Hola${name?', '+name:''}. 👋

Le escribimos para dar seguimiento a la cotización${reference} que le enviamos. Deseamos confirmar si pudo revisarla y saber si tiene alguna pregunta, necesita algún ajuste o desea continuar con el servicio.

Quedamos atentos para ayudarle y coordinar los próximos pasos.

Gracias por considerar a ${state.profile?.businessName || 'nuestro negocio'}.`;
  }
  return `Hola${name?', '+name:''}, te escribimos de ${state.profile?.businessName || 'nuestro negocio'}. ${maintenanceHistorySentence(f)}Queríamos saber cómo te ha ido con el servicio. Si todavía no has coordinado el mantenimiento, puedo ayudarte con una fecha.`;
}
function followCard(f){ const c = clientBy(f.clientId); const phone = phoneLink(c); const text=mobileFollowupMessage(f,c); return `<div class="row-card"><div class="top"><div><h4>${esc(f.title || f.type || 'Seguimiento')}</h4><p>${esc(f.clientName || c.name || 'Cliente')} · ${esc(f.dueDate || 'Sin fecha')}</p></div>${statusBadge(followStatus(f))}</div><p>${esc(f.type || '')} · cada ${esc(f.intervalMonths || 6)} meses</p><div class="actions">${phone ? `<a href="${phone}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<button data-complete-follow="${esc(f.id)}" type="button">Completar</button><button class="danger" data-delete-follow="${esc(f.id)}" type="button">Borrar</button></div></div>`; }

function renderFollowups(){
  let rows = followupRows();
  const query=normalizeClientSearch($('mFollowSearch')?.value);
  if(query)rows=rows.filter(f=>normalizeClientSearch([f.clientName,clientBy(f.clientId).name,f.title,f.type].join(' ')).includes(query));
  if(currentFilter === 'due') rows = rows.filter(f => followStatus(f) === 'Vencida');
  if(currentFilter === 'next') rows = rows.filter(f => followStatus(f) === 'Próximo');
  if(currentFilter === 'maint') rows = rows.filter(f => String(f.type || '').toLowerCase().includes('mant'));
  $('mFollowupList').innerHTML = rows.length ? rows.map(followCard).join('') : '<div class="empty">Sin seguimientos para este filtro.</div>';
}
function renderClients(){
  const q = String($('mClientSearch')?.value || '').toLowerCase();
  const rows = state.clients.filter(c => [c.name,c.phone,c.email,c.address].join(' ').toLowerCase().includes(q)).sort((a,b)=>String(a.name||'').trim().localeCompare(String(b.name||'').trim(),'es',{sensitivity:'base'}));
  $('mClientCount').textContent = `${state.clients.length} clientes`;
  $('mClientList').innerHTML = rows.length ? rows.map(c => { const invs = state.invoices.filter(i => i.clientId === c.id), fol = state.followups.filter(f => f.clientId === c.id); return `<div class="row-card nova-client-card"><div class="top"><div class="nova-record-title"><span class="nova-record-icon record-client" aria-hidden="true">${esc(String(c.name||'C').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase())}</span><div><h4>${esc(c.name || 'Cliente')}</h4><p>${esc(c.phone || '')} ${c.email ? '· ' + esc(c.email) : ''}</p></div></div><span class="badge">${invs.length} fac.</span></div><p>${esc(c.address || c.city || '')}</p><div class="actions"><button data-new-invoice-client="${esc(c.id)}" type="button">Facturar</button><button data-client-history="${esc(c.id)}" type="button">Historial</button>${phoneLink(c) ? `<a href="${phoneLink(c)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<span class="badge">${fol.length} seg.</span></div></div>`; }).join('') : '<div class="empty">Sin clientes.</div>';
}
function renderHistory(){
  const q = String($('mHistorySearch')?.value || '').toLowerCase();
  const items = [];
  state.invoices.forEach(i => items.push({ invoiceId:i.id,date:i.date, type:'Factura', title:i.number, client:i.clientName, detail:`${i.serviceTitle || i.invoiceType || 'Servicio'} · ${money(i.total)} · ${invoiceStatus(i)}` }));
  state.payments.forEach(p => items.push({ date:p.date, type:'Cobro', title:p.invoiceNumber, client:'', detail:`${p.method || 'Pago'} · ${money(p.amount)}` }));
  state.followups.forEach(f => items.push({ date:f.dueDate, type:'Seguimiento', title:f.title || f.type, client:f.clientName, detail:`${followStatus(f)} · ${f.type || ''}` }));
  state.services.forEach(s => items.push({ date:s.date, type:'Servicio', title:s.title || s.serviceType || 'Servicio', client:s.clientName, detail:`${s.status || ''} · ${money(s.amount)}` }));
  const rows = items.filter(x => [x.title,x.client,x.detail,x.type].join(' ').toLowerCase().includes(q)).sort((a,b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0,80);
  $('mHistoryList').innerHTML = rows.length ? rows.map(x => `<div class="timeline-item"><div><h4>${esc(x.date || '—')} · ${esc(x.type)}</h4><p><b>${esc(x.client || '')}</b> ${esc(x.title || '')}</p><p>${esc(x.detail || '')}</p>${x.invoiceId?`<div class="actions"><button type="button" data-edit-invoice="${esc(x.invoiceId)}">Editar factura</button></div>`:''}</div></div>`).join('') : '<div class="empty">Sin historial.</div>';
}
function renderSyncDetails(){
  const installBox = $('mInstallBox');
  if(installBox) installBox.innerHTML = isStandalone() ? '<b>Instalada:</b> Nexus Mobile Local está corriendo como app PWA.' : '<b>Instalación iPhone/iPad:</b> abre en Safari → Compartir → Añadir a pantalla de inicio.';
  const online = navigator.onLine ? 'Local · internet disponible' : 'Local · sin internet';
  const standalone = isStandalone() ? 'App instalada' : 'Navegador';
  $('mSyncDetails').innerHTML = [['Versión', APP_VERSION], ['Estado', online], ['Modo', standalone], ['Clientes', state.clients.length], ['Facturas', state.invoices.length], ['Cobros', state.payments.length], ['Seguimientos', state.followups.length], ['Cotizaciones', state.quotes.length], ['Servicios', state.services.length]].map(x => `<div class="metric"><small>${x[0]}</small><b>${x[1]}</b></div>`).join('');
}
function resetMobileInvoiceEditor(){
  editingInvoiceId=null;
  $('mInvoiceForm').reset();
  invoiceLines=[newLine('',1,0)];
  $('mInvoiceEditorTitle').textContent='Nueva factura';
  $('mCancelInvoiceEdit').hidden=true;
  $('mSaveInvoice').textContent='Guardar factura';
  $('mSaveDraft').hidden=false;
  $('mInvNumber').readOnly=false;
  renderSelects();chooseMobileClient('mInvClient','');renderInvoiceLines();setInvoiceStatus('Pendiente');
}
function editMobileInvoice(id){
  const inv=state.invoices.find(i=>i.id===id);if(!inv)return;
  invoiceEditReturnView=document.querySelector('.mobile-view.active')?.id||'mInvoices';
  if(inv.status==='Cancelada')return alert('La factura está cancelada.');
  editingInvoiceId=id;
  const set=(id,value)=>{$(id).value=value??'';};
  switchTab('mInvoice');
  if(!state.clients.some(c=>c.id===inv.clientId))state.clients.push({id:inv.clientId,name:inv.clientName||'Cliente'});
  renderSelects();chooseMobileClient('mInvClient',inv.clientId);
  set('mInvNumber',inv.number);set('mInvDate',inv.date);set('mInvDue',inv.dueDate||inv.date);
  for(const [id,value] of [['mInvType',inv.invoiceType||'Servicio'],['mInvPaymentMethod',inv.paymentMethod||'']]){
    const select=$(id);if(value&&!Array.from(select.options).some(o=>o.value===value))select.add(new Option(value,value));set(id,value);
  }
  set('mInvNotes',inv.notes||'');
  const items=inv.items?.length?inv.items:[{description:inv.serviceTitle||inv.serviceType||'Servicio',qty:1,price:inv.subtotal??inv.total??0,taxable:Number(inv.ivu||inv.tax||0)>0}];
  invoiceLines=items.map(l=>newLine(l.description||l.desc||'',l.qty??l.quantity??1,l.price??l.unitPrice??0,l.discount||0,l.taxable!==false));
  $('mInvoiceEditorTitle').textContent='Editar factura '+(inv.number||'');
  $('mSaveInvoice').textContent='Guardar cambios';$('mCancelInvoiceEdit').hidden=false;$('mSaveDraft').hidden=true;
  $('mInvNumber').readOnly=true;
  renderInvoiceLines();setInvoiceStatus(invoicePaid(inv)>0?'Pendiente':inv.status||'Pendiente');
  $('mInvoiceEditorTitle').scrollIntoView({block:'start'});
}
async function saveInvoice(forcedStatus){
  if(invoiceSaving)return;
  const existing=editingInvoiceId?state.invoices.find(i=>i.id===editingInvoiceId):null;
  if(editingInvoiceId&&!existing)return alert('No se encuentra la factura. Vuelve a abrirla.');
  const c = clientBy($('mInvClient').value); if(!c.id) return alert('Selecciona cliente.');
  ensureLines();
  const validLines = invoiceLines.filter(l => String(l.description || '').trim() && Number(l.qty || 0) > 0);
  if(invoiceLines.some(l=>!String(l.description||'').trim()||!Number.isFinite(l.qty)||l.qty<=0||!Number.isFinite(l.price)||l.price<0||!Number.isFinite(l.discount)||l.discount<0||(!isDiscountLine(l)&&l.discount>l.qty*l.price)))return alert('Revisa todas las líneas: descripción, cantidad, precio y descuentos.');
  if(!validLines.length) return alert('Añade al menos una línea con descripción y cantidad.');
  const calc = invoiceCalc();
  if(calc.discount>calc.subtotal)return alert('El descuento no puede exceder el subtotal.');
  let status = forcedStatus || $('mInvStatus').value || 'Pendiente';
  if(existing){const paid=invoicePaid(existing);if(existing.status==='Pagada'&&paid===0){if(Math.abs(calc.total-Number(existing.total))>0.005)return alert('Esta factura figura pagada sin cobros vinculados. Revisa sus cobros antes de cambiar el total.');status='Pagada';}if(calc.total+0.005<paid)return alert('El total no puede ser menor al importe ya cobrado.');if(status==='Pagada'&&existing.status!=='Pagada'&&calc.total-paid>0.005)return alert('Guarda los cambios como pendiente y registra el pago desde Saldar factura.');status=paid>0?(calc.total-paid<=0.005?'Pagada':'Parcial'):(existing.status==='Pagada'?'Pagada':status==='Borrador'?'Borrador':'Pendiente');}
  const number = $('mInvNumber').value || 'INV-M-' + String(Date.now()).slice(-7);
  const payload = { number, date:$('mInvDate').value, dueDate:$('mInvDue').value, clientId:c.id, clientName:c.name || '', invoiceType:$('mInvType').value, serviceTitle:validLines[0]?.description || $('mInvType').value, items:validLines.map(l => ({ description:l.description, qty:Number(l.qty||1), price:Number(l.price||0), discount:Number(l.discount||0), taxable:l.taxable !== false, total:lineNet(l) })), subtotal:calc.subtotal, discount:calc.discount, ivu:calc.ivu, tax:calc.ivu, taxPercent:taxRate()*100, total:calc.total, status, notes:$('mInvNotes').value, terms:'Pago según acuerdo.', sourceType:'mobile-v62', paymentMethod:$('mInvPaymentMethod').value || '', updatedAt:serverTimestamp(), createdAt:serverTimestamp() };
  invoiceSaving=true;const button=$('mSaveInvoice');if(button)button.disabled=true;
  try{
  if(existing){
    delete payload.createdAt;delete payload.sourceType;delete payload.terms;payload.number=existing.number;
    await updateDoc(docRef('invoices',existing.id),payload);
    const updated={...existing,...payload};state.invoices=state.invoices.map(i=>i.id===existing.id?updated:i);lastCreatedInvoiceId=existing.id;
    const back=invoiceEditReturnView;resetMobileInvoiceEditor();renderAll();if(back)switchTab(back);openInvoiceDoc(existing.id,updated);return;
  }
  payload.number=await nextInvoiceNumber(db,uid(),state.invoices,payload.date);
  const ref = await createInvoiceWithPayment(payload);
  lastCreatedInvoiceId = ref.id;
  await createAutoFollowupFromInvoice(ref.id, payload).catch(err => console.warn('No se pudo crear seguimiento automático:', err));
  resetMobileInvoiceEditor();openInvoiceDoc(null, { id:ref.id, ...payload });
  }catch(error){alert('No se pudo guardar la factura: '+(error.message||error));}
  finally{invoiceSaving=false;if(button)button.disabled=false;}
}
async function createAutoFollowupFromInvoice(invoiceId, inv){
  const type = String(inv.invoiceType || inv.type || '').toLowerCase();
  const shouldCreate = type.includes('mant') || type.includes('instal');
  if(!shouldCreate || !inv.clientId) return;
  const dueDate = plusMonths(inv.date || today(), 6);
  const followType = type.includes('instal') ? 'Instalación' : 'Mantenimiento';
  await addDoc(colRef('followups'), cleanPayload({
    clientId:inv.clientId,
    clientName:inv.clientName || '',
    clientPhone:clientBy(inv.clientId).phone || clientBy(inv.clientId).whatsapp || '',
    type:followType,
    title:followType === 'Instalación' ? 'Seguimiento post-instalación / mantenimiento 6 meses' : 'Mantenimiento preventivo 6 meses',
    date:dueDate,
    dueDate,
    nextDate:dueDate,
    intervalMonths:6,
    status:'Programado',
    priority:'Normal',
    channel:'WhatsApp',
    note:'Creado automáticamente desde factura móvil.',
    sourceType:'invoice-mobile',
    sourceId:invoiceId,
    createdByUid:uid(),
    createdAt:serverTimestamp(),
    updatedAt:serverTimestamp()
  }));
}
async function completeFollowup(id){
  const f = state.followups.find(x => x.id === id); if(!f) return;
  try{
    await updateDoc(docRef('followups', id), { status:'Completado', completedAt:today(), updatedAt:serverTimestamp() });
    if(String(f.type || '').toLowerCase().includes('mant')){
      const dueDate = plusMonths(today(), Number(f.intervalMonths || 6));
      await addDoc(colRef('followups'), cleanPayload({ clientId:f.clientId || '', clientName:f.clientName || '', clientPhone:f.clientPhone || '', assetId:f.assetId || '', assetName:f.assetName || '', type:'Mantenimiento', title:f.title || 'Mantenimiento preventivo 6 meses', date:dueDate, dueDate, nextDate:dueDate, intervalMonths:Number(f.intervalMonths || 6), status:'Programado', priority:f.priority || 'Normal', channel:f.channel || 'WhatsApp', sourceType:'recurring-mobile', sourceId:id, createdByUid:uid(), createdAt:serverTimestamp(), updatedAt:serverTimestamp() }));
    }
    showMobileNotice('Seguimiento completado.', 'ok');
  }catch(err){
    console.error('Error completando seguimiento:', err);
    showMobileNotice(firebaseMessage(err), 'danger');
    alert(firebaseMessage(err));
  }
}
async function markInvoicePaid(id){try{const inv=state.invoices.find(i=>i.id===id);if(!inv)return;const method=prompt('Método de pago (efectivo, ATH Móvil, tarjeta, cheque, transferencia…)',inv.paymentMethod||'Efectivo');if(method===null||!method.trim())return;await settleInvoice(id,today(),method.trim());showMobileNotice('Cobro registrado','ok');}catch(e){showMobileNotice(e.message,'danger');}}
async function imageToDataUrl(src){
  if(!src) return '';
  try{
    if(String(src).startsWith('data:image')) return src;
    const res = await fetch(src, { cache:'force-cache' });
    if(!res.ok) throw new Error('Logo no disponible');
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer logo'));
      reader.readAsDataURL(blob);
    });
  }catch(err){
    return '';
  }
}
async function getPdfLogoDataUrl(){
  const p = state.profile || {};
  const candidates = [p.logoPdf, p.logoDashboard, p.logo];
  for(const src of candidates){
    const data = await imageToDataUrl(src);
    if(data) return data;
  }
  return '';
}
function currentInvoiceDocument(){return (currentDocId&&state.invoices.find(i=>i.id===currentDocId))||currentDocSnapshot||buildInvoicePreviewObject('Vista previa');}
function invoiceFilename(inv){return 'Factura-'+String(inv.number||'Vista-previa').replace(/[^a-z0-9_-]+/gi,'-')+'.pdf';}
async function buildInvoicePdfFile(inv, filename){
 if(!window.jspdf?.jsPDF)throw new Error('Motor PDF no disponible.');
 const totals=invoiceTotalsDoc(inv),existing=inv.id&&state.invoices.find(i=>i.id===inv.id);
 const paid=existing?invoicePaid(existing):(inv.status==='Pagada'?totals.total:Number(inv.paid||0));
 const balance=existing?invoiceBalance(existing):Math.max(0,totals.total-paid);
 const status=existing?invoiceStatus(existing):(['Cancelada','Borrador'].includes(inv.status)?inv.status:balance<=0?'Pagada':inv.status||'Pendiente');
 const p=state.profile||{},logo=await getPdfLogoDataUrl();
 const doc=renderInvoicePdf(window.jspdf.jsPDF,{profile:p,client:clientBy(inv.clientId),invoice:inv,totals,paid,balance,status,logo,paymentTerms:invoicePaymentTerms(inv,inv.terms||inv.conditions||'Pago según acuerdo.'),dateText:niceDate,lineNet});
 return new File([doc.output('blob')],filename||invoiceFilename(inv),{type:'application/pdf'});
}
async function shareInvoice(id){
  const inv = state.invoices.find(i => i.id === id);
  if(!inv) return;
  const filename = `Factura-${String(inv.number || id).replace(/[^a-z0-9_-]+/gi,'-')}.pdf`;
  const btn = document.querySelector(`[data-share-invoice="${CSS.escape(id)}"]`);
  const oldText = btn ? btn.textContent : '';
  try{
    if(btn){ btn.disabled = true; btn.textContent = 'Generando PDF…'; }
    await sleep(30);
    const file = await buildInvoicePdfFile(inv, filename);
    if(!file || file.size < 100) throw new Error('PDF vacío o inválido.');
    if(navigator.share && navigator.canShare && navigator.canShare({ files:[file] })){
      if(btn) btn.textContent = 'Compartiendo…';
      await navigator.share({ title:`Factura ${inv.number || ''}`, text:'Factura adjunta en PDF.', files:[file] });
      closeDoc();
      return;
    }
    await openPdfFile(file, filename);
    closeDoc();
  }catch(err){
    if(err.name==='AbortError')return;
    console.error('PDF share failed', err);
    alert('No se pudo compartir directamente. Se abrirá/descargará el PDF para compartirlo desde Archivos.');
    try{
      const file = await buildInvoicePdfFile(inv, filename);
      downloadPdfFile(file, filename);
    }catch(e){ console.error(e); }
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = oldText || 'Compartir'; }
  }
}
function downloadPdfFile(file, filename){
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || file.name || 'Factura.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 15000);
}
function fileToDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el PDF.'));
    reader.readAsDataURL(file);
  });
}
async function openPdfFile(file, filename, targetWindow=null){
  // iOS PWA: blob URLs suelen abrir como about:blank.
  // Solución: crear un visor HTML real y embeber el PDF como data URL.
  if(isIOSPWA()){
    await openPdfInIOSViewer(file, filename, targetWindow);
    return;
  }
  const url = URL.createObjectURL(file);
  if(targetWindow && !targetWindow.closed){
    targetWindow.location.href = url;
  }else{
    const opened = window.open(url, '_blank');
    if(!opened) downloadPdfFile(file, filename);
  }
  setTimeout(()=>URL.revokeObjectURL(url), 120000);
}
async function openPdfInIOSViewer(file, filename, targetWindow=null){
  const safeName = filename || file.name || 'Factura.pdf';
  const dataUrl = await fileToDataUrl(file);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${safeName}</title><style>body{margin:0;background:#f8fafc;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}.bar{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.96);backdrop-filter:blur(16px);padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;gap:10px;align-items:center;justify-content:space-between}.bar b{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.actions{display:flex;gap:8px}a,button{border:1px solid #bfdbfe;background:#fff;color:#1d4ed8;border-radius:12px;padding:10px 12px;font-weight:800;text-decoration:none;font-size:14px}.primary{background:#2563eb;color:white;border-color:#2563eb}.note{padding:10px 16px;color:#475569;font-size:13px}.viewer{height:calc(100vh - 112px);width:100%;border:0;background:#fff}object,iframe{width:100%;height:100%;border:0}.fallback{padding:24px;text-align:center}</style></head><body><div class="bar"><b>${safeName}</b><div class="actions"><a class="primary" href="${dataUrl}" download="${safeName}">Descargar</a></div></div><div class="note">Para imprimir o compartir: toca Descargar, abre el PDF desde Archivos y usa el menú Compartir.</div><div class="viewer"><object data="${dataUrl}" type="application/pdf"><iframe src="${dataUrl}"></iframe><div class="fallback"><p>Tu iPhone no mostró el PDF incrustado.</p><p><a class="primary" href="${dataUrl}" download="${safeName}">Descargar PDF</a></p></div></object></div></body></html>`;
  let w = targetWindow && !targetWindow.closed ? targetWindow : null;
  if(!w) w = window.open('', '_blank');
  if(w && !w.closed){
    w.document.open();
    w.document.write(html);
    w.document.close();
  }else{
    downloadPdfFile(file, safeName);
  }
}
function invoiceShareText(inv){ return `${state.profile?.businessName || 'Mi negocio'}\nFactura: ${inv.number}\nCliente: ${inv.clientName}\nTotal: ${money(inv.total)}\nEstado: ${invoiceStatus(inv)}\nBalance: ${money(invoiceBalance(inv))}`; }
function buildInvoicePreviewObject(number='Vista previa'){
  const c = clientBy($('mInvClient')?.value); const calc = invoiceCalc();
  return { number, date:$('mInvDate')?.value || today(), dueDate:$('mInvDue')?.value || plusDays(15), clientId:c.id||'', clientName:c.name || 'Cliente', invoiceType:$('mInvType')?.value || 'Servicio', items:invoiceLines.map(l => ({ description:l.description, qty:l.qty, price:l.price, discount:l.discount, taxable:l.taxable, total:lineNet(l) })), subtotal:calc.subtotal, discount:calc.discount, ivu:calc.ivu, taxPercent:taxRate()*100, total:calc.total, status:$('mInvStatus')?.value || 'Pendiente', notes:$('mInvNotes')?.value || '' };
}

function niceDate(v){
  if(!v) return '';
  const parts = String(v).split('-');
  if(parts.length === 3){
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString('es-PR', { year:'numeric', month:'long', day:'numeric' });
  }
  return String(v);
}
function invoiceTotalsDoc(inv){
  const itemsSubtotal = Array.isArray(inv.items) && inv.items.length ? inv.items.reduce((a,it)=>a + (Number(it.qty || 1) * Number(it.price || 0)), 0) : 0;
  const itemsDiscount = Array.isArray(inv.items) && inv.items.length ? inv.items.reduce((a,it)=>a + Number(it.discount || 0), 0) : 0;
  const subtotal = Number(inv.subtotal ?? (itemsSubtotal || Number(inv.total || 0)));
  const discount = Number(inv.discount ?? itemsDiscount ?? 0);
  const ivu = Number(inv.ivu ?? inv.tax ?? 0);
  const total = Number(inv.total ?? (subtotal - discount + ivu));
  return { subtotal, discount, ivu, total, taxPercent:Number(inv.taxPercent ?? state.profile?.tax ?? 0) };
}
function invoiceDocFooter(){
  const p = state.profile || {};
  return `</div><div class="invoice-thanks">¡Gracias por su preferencia!</div><div class="invoice-footer"><span>${esc(p.businessName || 'Empresa')}</span><span>Gracias por su preferencia</span></div></div>`;
}
function buildDesktopInvoiceDocument(inv){
  const p = state.profile || {};
  const c = clientBy(inv.clientId);
  const totals = invoiceTotalsDoc(inv);
  const existing = currentDocId ? state.invoices.find(i => i.id === currentDocId) : null;
  const paid = existing ? invoicePaid(existing) : (String(inv.status || '') === 'Pagada' ? totals.total : 0);
  const bal = existing ? invoiceBalance(existing) : Math.max(0, totals.total - paid);
  const status = existing ? invoiceStatus(existing) : (bal <= 0 || String(inv.status || '') === 'Pagada' ? 'Pagada' : (String(inv.status || '') || 'Pendiente'));
  const logo = [p.logoPdf,p.logoDashboard].find(x=>typeof x==='string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(x));
  const itemList = Array.isArray(inv.items) && inv.items.length ? inv.items : [{ description:inv.serviceTitle || inv.invoiceType || 'Servicio', qty:1, price:totals.subtotal }];
  const rows = itemList.map(it => `<tr><td>${esc(it.description || 'Servicio')}</td><td>${esc(it.qty || 1)}</td><td>${money(it.price || 0)}</td><td>${money(lineNet(it))}</td></tr>`).join('');
  const note = esc(inv.notes || 'Gracias por confiar en nuestros servicios.');
  const terms = esc(invoicePaymentTerms(inv, inv.terms || inv.conditions || 'Pago a través del método acordado.'));
  return `<div class="doc-page invoice-pro"><div class="doc-body"><div class="invoice-top"><div class="invoice-brand">${logo ? `<img class="invoice-logo" src="${logo}">` : ''}<div><h1>${esc(p.businessName || 'Empresa')}</h1>${p.email ? `<p>${esc(p.email)}</p>` : ''}</div></div><div class="invoice-contact"><p>${esc(p.address || '')}</p>${p.phone ? `<p>${esc(p.phone)}</p>` : ''}${p.email ? `<p>${esc(p.email)}</p>` : ''}${p.web ? `<p>${esc(p.web)}</p>` : ''}</div></div><div class="invoice-title-row"><div class="invoice-number"><p><b>No. de Factura:</b> ${esc(inv.number || 'Factura')}</p><p><b>Fecha:</b> ${esc(niceDate(inv.date))}</p><p><b>Vence:</b> ${esc(inv.dueDate ? niceDate(inv.dueDate) : '—')}</p></div><h2>FACTURA</h2><div class="status-card"><b>ESTADO</b><span>${esc(status).toUpperCase()}</span></div></div><div class="invoice-rule"></div><div class="invoice-client-grid"><div class="invoice-box"><b>CLIENTE</b><p>${esc(inv.clientName || c.name || '')}</p></div><div class="invoice-box"><p><b>Teléfono:</b> ${esc(c.phone || '—')}</p><p><b>Dirección:</b> ${esc(c.address || c.city || '—')}</p></div></div><table class="doc-table invoice-items"><tr><th>Descripción</th><th>Cant.</th><th>Precio Unit.</th><th>Total</th></tr>${rows}</table><div class="invoice-lower"><div><div class="invoice-box note-box"><b>NOTAS</b><p>${note}</p></div><div class="invoice-box note-box"><b>CONDICIONES</b><p>${terms}</p></div>${p.signature ? `<div class="invoice-sign"><img src="${p.signature}"><br>Firma autorizada</div>` : ''}</div><div class="invoice-totals"><div><b>SUBTOTAL</b><span>${money(totals.subtotal)}</span></div>${totals.discount?`<div><b>DESCUENTOS</b><span>${money(-totals.discount)}</span></div>`:''}<div><b>IVU (${totals.taxPercent}%)</b><span>${money(totals.ivu)}</span></div><div class="total-row"><b>TOTAL</b><span>${money(totals.total)}</span></div><div><b>PAGADO</b><span>${money(paid)}</span></div><div class="balance-row"><b>BALANCE</b><span>${money(bal)}</span></div></div></div>` + invoiceDocFooter();
}
function openInvoiceDoc(id, supplied=null){
  const inv = supplied || state.invoices.find(i => i.id === id);
  if(!inv) return;
  if($('mDocModal').classList.contains('hidden'))documentOrigin=viewMemory.capture();
  currentDocId = inv.id || id || null;
  currentDocSnapshot = structuredClone(inv);
  $('mDocPreview').innerHTML = buildDesktopInvoiceDocument(inv);
  $('mDocModal').classList.remove('hidden');
}
async function printCurrentDoc(){
 const inv=currentInvoiceDocument(),name=invoiceFilename(inv),btn=$('mPrintDoc');
 if(btn.disabled)return;btn.disabled=true;btn.textContent='Preparando PDF…';
 // Open the browser's native PDF viewer, not the HTML preview. On iOS,
 // the native share sheet offers Print / AirPrint and Save to Files.
 let target=null;
 if(!isIOS())try{target=window.open('','_blank');if(target){target.document.title='Preparando factura';target.document.body.textContent='Preparando PDF…';target.opener=null;}}catch{}
 try{
  const file=await buildInvoicePdfFile(inv,name);
  if(isIOS()&&navigator.share&&navigator.canShare?.({files:[file]})){
   try{await navigator.share({title:name,files:[file]});showMobileNotice('Selecciona Imprimir en el menú de compartir.','ok');return;}
   catch(e){if(e.name==='AbortError')return;}
  }
  if(isIOS()){
   downloadPdfFile(file,name);showMobileNotice('Abre el PDF desde Archivos y selecciona Compartir → Imprimir.','ok');return;
  }
  const url=URL.createObjectURL(file);
  if(target&&!target.closed){target.location.href=url;setTimeout(()=>URL.revokeObjectURL(url),600000);showMobileNotice('Imprime desde el visor PDF.','ok');}
  else{URL.revokeObjectURL(url);downloadPdfFile(file,name);showMobileNotice('Abre el PDF descargado y selecciona Imprimir.','ok');}
 }catch(e){try{target?.close();}catch{}showMobileNotice('No se pudo preparar la impresión: '+e.message,'danger');}
 finally{btn.disabled=false;btn.textContent='Imprimir PDF';}
}
function closeDoc(){ $('mDocModal').classList.add('hidden');currentDocSnapshot=null;if(documentOrigin)viewMemory.restore(documentOrigin);documentOrigin=null; }
async function shareCurrentDoc(){
  if(currentDocId) return shareInvoice(currentDocId);
  const preview = currentInvoiceDocument();
  const filename = 'Factura-Vista-Previa.pdf';
  try{
    const file = await buildInvoicePdfFile(preview, filename);
    if(!file || file.size < 100) throw new Error('PDF vacío o inválido.');
    if(navigator.share && navigator.canShare && navigator.canShare({ files:[file] })){
      await navigator.share({ title:'Factura', text:'Vista previa de factura adjunta en PDF.', files:[file] });
      closeDoc();
      return;
    }
    await openPdfFile(file, filename);
    closeDoc();
  }catch(err){
    console.error(err);
    alert('No se pudo preparar el PDF. Se intentará descargarlo.');
    try{ downloadPdfFile(await buildInvoicePdfFile(preview, filename), filename); }catch(e){ console.error(e); }
  }
}

// Read the shared service records without altering their workflow or billing state.
function renderServices(){
  const query = ($('mServiceSearch')?.value || '').trim().toLowerCase();
  const rows = [...state.services].filter(s => {
    const status = s.status || s.fields?.[3] || '';
    const c = clientBy(s.clientId);
    return !['Completado','Completada','Cancelado','Cancelada','Facturado'].includes(status) && `${s.title || s.serviceType || ''} ${s.clientName || c.name || ''} ${s.date || ''}`.toLowerCase().includes(query);
  }).sort((a,b)=>String(a.date || '9999').localeCompare(String(b.date || '9999')));
  $('mServiceList').innerHTML = rows.length ? rows.map(s=>{
    const c=clientBy(s.clientId), address=c.address || c.city || '', phone=String(c.phone || '').replace(/[^+0-9]/g,'');
    return `<article class="row-card"><div class="top"><div><h4>${esc(s.title || s.serviceType || 'Servicio')}</h4><p>${esc(s.clientName || c.name || 'Cliente')}</p></div>${statusBadge(s.status || s.fields?.[3] || 'Programado')}</div><p>${esc(s.date || 'Sin fecha')} ${esc(s.time || '')}</p><p>${esc(address)}</p><div class="actions">${phone?`<a href="tel:${esc(phone)}">Llamar</a>`:''}${phoneLink(c)?`<a href="${phoneLink(c)}" target="_blank" rel="noopener">WhatsApp</a>`:''}${address?`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" target="_blank" rel="noopener">Ver ruta</a>`:''}<button data-local-complete="${esc(s.id)}" type="button">Completar</button><button data-new-invoice-client="${esc(s.clientId || '')}" type="button">Facturar cliente</button></div></article>`;
  }).join('') : '<div class="empty">No hay trabajos pendientes para esta búsqueda.</div>';
}
$('mServiceSearch')?.addEventListener('input', renderServices);

// Search clients without opening a long native select menu.
let returnClientPicker=null;
function chooseMobileClient(picker,id){
  const c=clientBy(id),select=$(picker),input=$(picker+'Search');
  if(!select||!input)return;
  if(id&&!Array.from(select.options).some(o=>o.value===id))select.add(new Option(c.name||'Cliente',id));
  select.value=id||'';input.value=c.name||'';
  input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');
  $(picker+'Results').hidden=true;
  $(picker+'Selected').textContent=c.id?[c.phone||c.whatsapp,c.email,c.city].filter(Boolean).join(' · ')||'Cliente seleccionado':'Busca y selecciona un cliente existente.';
}
function showClientResults(picker){
  const input=$(picker+'Search'),box=$(picker+'Results');if(!input||!box)return;
  const rows=searchClients(state.clients,input.value,8);
  box.innerHTML=rows.length?rows.map((c,i)=>`<button id="${picker}Option${i}" type="button" role="option" aria-selected="false" data-pick-client="${esc(c.id)}" data-picker-id="${picker}"><b>${esc(c.name||'Cliente')}</b><small>${esc([c.phone||c.whatsapp,c.email||c.city].filter(Boolean).join(' · '))}</small></button>`).join(''):'<div class="empty">No hay coincidencias. Puedes crear un nuevo cliente.</div>';
  box.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');
}
for(const picker of ['mInvClient','mFollowClient']){
  const input=$(picker+'Search');
  input?.addEventListener('input',()=>{$(picker).value='';$(picker+'Selected').textContent='Selecciona uno de los resultados.';showClientResults(picker);});
  input?.addEventListener('focus',()=>showClientResults(picker));
  input?.addEventListener('keydown',e=>{
    const box=$(picker+'Results');
    if(e.key==='Escape'){box.hidden=true;input.setAttribute('aria-expanded','false');return;}
    if(!['ArrowDown','ArrowUp','Enter'].includes(e.key))return;
    if(box.hidden){if(e.key==='Enter')return;showClientResults(picker);}
    const options=[...box.querySelectorAll('[data-pick-client]')];if(!options.length)return;
    e.preventDefault();let index=options.findIndex(o=>o.getAttribute('aria-selected')==='true');
    if(e.key==='Enter'){if(index>=0)chooseMobileClient(picker,options[index].dataset.pickClient);return;}
    index=e.key==='ArrowDown'?Math.min(index+1,options.length-1):Math.max(index-1,0);
    options.forEach((o,i)=>o.setAttribute('aria-selected',i===index?'true':'false'));
    input.setAttribute('aria-activedescendant',options[index].id);options[index].scrollIntoView({block:'nearest'});
  });
}
document.addEventListener('click',e=>{
  const choice=e.target.closest('[data-pick-client]');
  if(choice){chooseMobileClient(choice.dataset.pickerId,choice.dataset.pickClient);return;}
  const add=e.target.closest('[data-add-client]');
  if(add){returnClientPicker=add.dataset.addClient;switchTab('mClients');$('mNewClientPanel').open=true;$('mClientName').focus({preventScroll:true});$('mNewClientPanel').scrollIntoView({block:'start',behavior:'smooth'});return;}
  if(!e.target.closest('.client-picker'))for(const id of ['mInvClient','mFollowClient']){$(id+'Results').hidden=true;$(id+'Search').setAttribute('aria-expanded','false');}
  const history=e.target.closest('[data-client-history]');if(history){$('mHistorySearch').value=clientBy(history.dataset.clientHistory).name||'';renderHistory();switchTab('mHistory');}
});
const agenda=createAgenda({$,state,clientBy,today,esc,phoneLink,statusBadge,colRef,docRef,addDoc,updateDoc,serverTimestamp,switchTab,showMobileNotice});
const alertCenter=createAlertCenter({$,state,today,invoiceBalance,invoiceStatus,money,docRef,updateDoc,showMobileNotice,esc,openConfirmation:id=>{switchTab('mAgenda');agenda.share(id);}});
const finance=createFinance({$,state,today,money,esc,colRef,docRef,addDoc,updateDoc,showMobileNotice});
function renderMobileTools(){
  agenda.render();
  const q=normalizeClientSearch($('mReceivableSearch').value);
  const invoices=sorted(state.invoices).filter(i=>!['Cancelada','Borrador'].includes(invoiceStatus(i))&&invoiceBalance(i)>0);
  $('mReceivableTotal').textContent=money(invoices.reduce((a,i)=>a+invoiceBalance(i),0))+' pendiente · '+invoices.length+' facturas';
  const filtered=invoices.filter(i=>normalizeClientSearch([i.number,i.clientName,clientBy(i.clientId).name].join(' ')).includes(q));
  $('mReceivableList').innerHTML=filtered.length?filtered.map(i=>`<article class="row-card"><div class="top"><div><h4>${esc(i.clientName||clientBy(i.clientId).name||'Cliente')}</h4><p>${esc(i.number||'Factura')} · Vence ${esc(i.dueDate||'Sin fecha')}</p></div>${statusBadge(invoiceStatus(i))}</div><p>Balance <b>${money(invoiceBalance(i))}</b></p><div class="actions"><button data-edit-invoice="${esc(i.id)}" type="button">Editar factura</button><button data-view-invoice="${esc(i.id)}" type="button">Ver factura</button><button data-share-invoice="${esc(i.id)}" type="button">Compartir</button><button data-mark-paid="${esc(i.id)}" type="button">Saldar factura</button></div></article>`).join(''):'<div class="empty">No hay balances para esta búsqueda.</div>';
}
function calculateMobilePrice(){
  const amount=Math.max(0,Number($('mCalcAmount').value)||0),discount=Math.min(100,Math.max(0,Number($('mCalcDiscount').value)||0)),rate=Math.min(100,Math.max(0,Number($('mCalcTax').value)||0));
  const net=amount*(1-discount/100),tax=net*rate/100;
  $('mCalcResult').innerHTML=`<div class="summary-row"><span>Descuento</span><b>${money(amount-net)}</b></div><div class="summary-row"><span>Subtotal</span><b>${money(net)}</b></div><div class="summary-row"><span>IVU</span><b>${money(tax)}</b></div><div class="summary-row total"><span>Total</span><b>${money(net+tax)}</b></div>`;
}
$('mReceivableSearch')?.addEventListener('input',renderMobileTools);
$('mFollowSearch')?.addEventListener('input',renderFollowups);
for(const id of ['mCalcAmount','mCalcDiscount','mCalcTax'])$(id)?.addEventListener('input',calculateMobilePrice);
calculateMobilePrice();

$('mInvoicesSearch')?.addEventListener('input',()=>{mobileInvoiceListLimit=40;renderMobileInvoiceList();});
$('mInvoicesStatus')?.addEventListener('change',()=>{mobileInvoiceListLimit=40;renderMobileInvoiceList();});

setupStandalone({$,state,COLS,colRef,docRef,clientBy,today,switchTab,ensureLines,renderInvoiceLines,renderAll,renderSummary,calculateMobilePrice,setSync,showMobileNotice});
