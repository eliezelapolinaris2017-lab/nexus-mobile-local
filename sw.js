const CACHE='nexus-mobile-local-v3.2.2-auth';
const ASSETS=['./index.html','./mobile.js','./mobile.css','./mobile-field.css','./nova.css','./agenda.css','./agenda.js','./confirmations.js','./confirmations.css','./cloud.js','./cloud.css','./alerts.js','./alerts.css','./finance.js','./finance.css','./invoice-pdf.js','./hvac-codes.js','./maintenance.js','./hvac.css','./confirmar.html','./confirm-page.js','./standalone-ui.js','./local-db.js','./client-search.js','./ui-context.js','./vendor/jspdf.umd.min.js','./manifest.webmanifest','./icon.svg','./nova-icon-180.png','./nova-icon-192.png','./nova-icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('nexus-mobile-local-')&&k!==CACHE)await caches.delete(k);await self.clients.claim();})()));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url),scope=self.registration.scope;
 if(req.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(scope))return;
 const isDocument=req.mode==='navigate'||req.destination==='document'||(req.headers.get('accept')||'').includes('text/html');
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(isDocument){
   const shell=new URL(url.pathname.endsWith('/confirmar.html')?'confirmar.html':'index.html',scope).href;
   const cached=await cache.match(shell);
   if(cached)return cached;
   return fetch(req);
  }
  return (await cache.match(req))||fetch(req);
 })());
});
