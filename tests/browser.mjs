import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
const base='http://127.0.0.1:8080/';
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR:',e.message);});page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log('BROWSER:',m.type(),m.text());});page.on('dialog',d=>d.type()==='prompt'?d.accept('Efectivo'):d.accept());

 const fakeOwner='11111111-1111-4111-8111-111111111111',cloudRows=[],invites=new Map();
 await context.route('https://cgpfpxueqciefclonghz.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),method=req.method();let body={};try{body=req.postDataJSON()||{};}catch{}
  const reply=(value,status=200)=>route.fulfill({status,json:value,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}});
  if(method==='OPTIONS')return reply({});
  if(url.pathname.startsWith('/auth/v1/token')||url.pathname==='/auth/v1/signup')return reply({access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:fakeOwner,email:'test@example.com'}});
  if(url.pathname==='/rest/v1/nova_workspaces'){
   if(method==='POST'){if(cloudRows.length)return reply({message:'duplicate'},409);cloudRows.push({owner_id:fakeOwner,revision:1,snapshot:body.snapshot,updated_at:new Date().toISOString()});return reply(cloudRows,201);}
   if(method==='PATCH'){const n=Number(url.searchParams.get('revision')?.slice(3));if(!cloudRows.length||cloudRows[0].revision!==n)return reply([]);Object.assign(cloudRows[0],{snapshot:body.snapshot,revision:n+1,updated_at:new Date().toISOString()});return reply(cloudRows);}return reply(cloudRows);
  }
  if(url.pathname==='/functions/v1/nova-confirmations'){if(body.action==='provision')return reply({ok:true});if(body.action==='create'){invites.set(body.id,{id:body.id,token:body.token,state:'pending'});return reply({ok:true});}if(body.action==='revoke'){if(invites.has(body.id))invites.get(body.id).state='revoked';return reply({ok:true});}if(body.action==='status')return reply({items:body.ids.map(id=>invites.get(id)).filter(Boolean)});if(body.action==='confirm'){const i=[...invites.values()].find(i=>i.token===body.token);if(!i||i.state==='revoked')return reply({error:'invalid'},410);i.state='confirmed';return reply({state:'confirmed'});}}
  return reply({error:'unmocked'},404);
 }); await page.goto(base);await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.locator('#novaLoginPanel [name=email]').fill('test@example.com');await page.locator('#novaLoginPanel [name=password]').fill('test-password');await page.locator('#novaLoginPanel [data-mode=login]').click();await page.locator('#localSetupName').fill('Prueba Local');await page.locator('#mobileAuthForm button[type=submit]').click();try{await page.locator('#mobileApp').waitFor({state:'visible',timeout:15000});}catch(e){console.error('ONBOARDING:',await page.locator('#mobileAuthMsg').textContent(),await page.locator('#localSetupName').inputValue());console.error('DB:',await page.evaluate(async()=>{try{return await (await import('/local-db.js')).getProfile()}catch(e){return String(e)}}));throw e;}assert.equal(await page.locator('.nova-tile').count(),6);await page.locator('.nova-metric').first().waitFor();assert.equal(await page.locator('.nova-metric').count(),4);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload();await page.locator('#mobileApp').waitFor({state:'visible'});
 await page.locator('nav [data-tab=mClients]').click();await page.locator('#mNewClientPanel summary').click();await page.locator('#mClientName').fill('Cliente de prueba');await page.locator('#mClientPhone').fill('7875550100');await page.locator('#mClientForm button[type=submit]').click();
 await page.locator('#mInvoice.active').waitFor();await page.locator('[data-line-field=description]').first().fill('Servicio de prueba');await page.locator('[data-line-field=price]').first().fill('100');
 assert.match(await page.locator('#mInvTotal').innerText(),/111[.,]50/);
 await page.locator('#mSaveInvoice').click();await page.locator('#mDocModal:not(.hidden)').waitFor();
 assert.match(await page.locator('#mDocPreview').innerText(),/Cliente de prueba/);
 const downloadPromise=page.waitForEvent('download');await page.locator('#mDownloadDoc').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/\.pdf$/);await page.locator('#mCloseDoc').click();
 const workspace=()=>page.evaluate(async()=>{const m=await import('/local-db.js');return m.exportWorkspace();});
 let backup=await workspace();assert.equal(Object.keys(backup.records.clients).length,1);assert.equal(Object.keys(backup.records.invoices).length,1);
 await page.locator('nav [data-tab=mMore]').click();await page.locator('#mMore [data-tab=mAgenda]').click();await page.locator('#agendaNew').click();
 await page.locator('#agendaClient').selectOption(Object.keys(backup.records.clients)[0]);await page.locator('#agendaTitle').fill('Cita de agenda');await page.locator('#agendaTime').fill('09:30');await page.locator('#agendaSave').click();await page.locator('#confirmShareDialog').waitFor({state:'visible'});const prepared=await page.locator('#confirmMessage').inputValue();assert.match(prepared,/Cliente de prueba/);assert.match(prepared,/9:30 a\. m\./);assert.match(prepared,/Prueba Local/);await page.locator('#confirmWhatsApp').waitFor({state:'visible'});assert.match(await page.locator('#confirmWhatsApp').getAttribute('href'),/^https:\/\/wa.me\/17875550100\?text=/);await page.waitForFunction(()=>document.getElementById('confirmMessage').value.includes('confirmar.html#'));assert.match(await page.locator('#confirmShareStatus').textContent(),/Enlace listo/);await page.locator('#confirmShareClose').click();await page.locator('#mAgendaList').getByText('Cita de agenda',{exact:true}).waitFor();
 await page.locator('#mAgendaList [data-agenda-edit]').click();await page.locator('#agendaTime').fill('10:30');await page.locator('#agendaSave').click();await page.locator('#confirmShareDialog').waitFor({state:'visible'});assert.match(await page.locator('#confirmMessage').inputValue(),/10:30 a\. m\./);await page.locator('#confirmShareClose').click();await page.locator('#mAgendaList').getByText('10:30 a. m.',{exact:true}).waitFor();
 await page.locator('#mAgendaList [data-agenda-done]').click();await page.locator('#mAgendaList').getByText('Completado',{exact:true}).waitFor();
 const agendaBackup=await workspace();assert.equal(Object.values(agendaBackup.records.services)[0].time,'10:30');assert.equal(Object.values(agendaBackup.records.services)[0].status,'Completado');
 assert.equal(Object.values(backup.records.invoices)[0].total,111.5);
 await page.locator('nav [data-tab=mServices]').click();await page.locator('#mServices summary').click();await page.locator('#localServiceClient').selectOption(Object.keys(backup.records.clients)[0]);await page.locator('#localServiceTitle').fill('Trabajo prueba');await page.locator('#localServiceForm button[type=submit]').click();await page.locator('#mServiceList').getByText('Trabajo prueba',{exact:true}).waitFor();await page.locator('#mServiceList [data-local-complete]').click();await page.locator('#mServiceList [data-local-complete]').waitFor({state:'detached'});
 await page.locator('nav [data-tab=mMore]').click();await page.locator('#mMore [data-tab=mReceivable]').click();await page.locator('#mReceivableList [data-mark-paid]').first().click();
 await page.waitForFunction(async()=>Object.keys((await (await import('/local-db.js')).exportWorkspace()).records.payments).length===1);
 backup=await workspace();assert.equal(Object.values(backup.records.payments)[0].amount,111.5);
 await page.evaluate(async()=>{const m=await import('/local-db.js');const b=await m.exportWorkspace();await m.restoreWorkspace(b);});
 await context.setOffline(true);await page.reload();await page.locator('#mobileApp').waitFor({state:'visible'});assert.equal(await page.locator('#mobileBusiness').innerText(),'Prueba Local');
 const offline=await workspace();assert.equal(Object.keys(offline.records.invoices).length,1);assert.equal(Object.keys(offline.records.services).length,2);assert.ok(Object.values(offline.records.services).every(s=>s.status==='Completado'));
 await page.locator('nav [data-tab=mClients]').click();await page.locator('#mNewClientPanel summary').click();await page.locator('#mClientName').fill('Cliente offline');await page.locator('#mClientForm button[type=submit]').click();
 await page.waitForFunction(async()=>Object.keys((await (await import('/local-db.js')).exportWorkspace()).records.clients).length===2);
 assert.deepEqual(errors,[]);console.log(engine.name()+': configuración, factura, cobro, trabajo, respaldo y creación offline correctos');
 }finally{await browser.close();}
}
