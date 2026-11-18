import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
const base='http://127.0.0.1:8080/';
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='prompt'?d.accept('Efectivo'):d.accept());
 await page.goto(base);await page.locator('#localSetupName').fill('Prueba Local');await page.locator('#mobileAuthForm button[type=submit]').click();await page.locator('#mobileApp').waitFor({state:'visible'});
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload();await page.locator('#mobileApp').waitFor({state:'visible'});
 await page.locator('nav [data-tab=mClients]').click();await page.locator('#mNewClientPanel summary').click();await page.locator('#mClientName').fill('Cliente de prueba');await page.locator('#mClientPhone').fill('7875550100');await page.locator('#mClientForm button[type=submit]').click();
 await page.locator('#mInvoice.active').waitFor();await page.locator('[data-line-field=description]').first().fill('Servicio de prueba');await page.locator('[data-line-field=price]').first().fill('100');
 assert.match(await page.locator('#mInvTotal').innerText(),/111[.,]50/);
 await page.locator('#mSaveInvoice').click();await page.locator('#mDocModal:not(.hidden)').waitFor();
 assert.match(await page.locator('#mDocPreview').innerText(),/Cliente de prueba/);
 await page.locator('#mCloseDoc').click();
 const workspace=()=>page.evaluate(async()=>{const m=await import('/local-db.js');return m.exportWorkspace();});
 let backup=await workspace();assert.equal(Object.keys(backup.records.clients).length,1);assert.equal(Object.keys(backup.records.invoices).length,1);
 assert.equal(Object.values(backup.records.invoices)[0].total,111.5);
 await page.locator('nav [data-tab=mServices]').click();await page.locator('#mServices summary').click();await page.locator('#localServiceClient').selectOption(Object.keys(backup.records.clients)[0]);await page.locator('#localServiceTitle').fill('Trabajo prueba');await page.locator('#localServiceForm button[type=submit]').click();await page.getByText('Trabajo prueba',{exact:true}).waitFor();
 await page.locator('nav [data-tab=mMore]').click();await page.locator('#mMore [data-tab=mReceivable]').click();await page.locator('#mReceivableList [data-mark-paid]').first().click();
 await page.waitForFunction(async()=>Object.keys((await (await import('/local-db.js')).exportWorkspace()).records.payments).length===1);
 backup=await workspace();assert.equal(Object.values(backup.records.payments)[0].amount,111.5);
 await page.evaluate(async()=>{const m=await import('/local-db.js');const b=await m.exportWorkspace();await m.restoreWorkspace(b);});
 await context.setOffline(true);await page.reload();await page.locator('#mobileApp').waitFor({state:'visible'});assert.equal(await page.locator('#mobileBusiness').innerText(),'Prueba Local');
 const offline=await workspace();assert.equal(Object.keys(offline.records.invoices).length,1);assert.equal(Object.keys(offline.records.services).length,1);
 await page.locator('nav [data-tab=mClients]').click();await page.locator('#mNewClientPanel summary').click();await page.locator('#mClientName').fill('Cliente offline');await page.locator('#mClientForm button[type=submit]').click();
 await page.waitForFunction(async()=>Object.keys((await (await import('/local-db.js')).exportWorkspace()).records.clients).length===2);
 assert.deepEqual(errors,[]);console.log(engine.name()+': configuración, factura, cobro, trabajo, respaldo y creación offline correctos');
 }finally{await browser.close();}
}
