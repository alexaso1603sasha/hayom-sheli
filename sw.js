const CACHE='hayom-sheli-v1';
const ASSETS=['./','index.html','styles.css','enhancements.css','app.js','manifest.webmanifest','icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request))));
self.addEventListener('push',event=>{const data=event.data?.json()||{};event.waitUntil(self.registration.showNotification(data.title||'היום שלי',{body:data.body||'יש לך תזכורת חדשה',icon:'icon.svg'}));});
