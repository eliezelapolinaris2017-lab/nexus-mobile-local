const CACHE='nexus-mobile-local-v1';
const ASSETS=['./index.html','./mobile.js','./mobile.css','./mobile-field.css','./standalone-ui.js','./local-db.js','./client-search.js','./ui-context.js','./vendor/jspdf.umd.min.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('nexus-mobile-local-')&&k!==CACHE)await caches.delete(k);await self.clients.claim();})()));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==self.location.origin)return;if(r.mode==='navigate'){e.respondWith(caches.open(CACHE).then(c=>c.match('./index.html')).then(v=>v||fetch(r)));return;}e.respondWith(caches.open(CACHE).then(c=>c.match(r)).then(v=>v||fetch(r)));});
