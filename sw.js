const CACHE='hayom-sheli-v11';
const ASSETS=['./','index.html','yomi.css','icon-180.png','icon-512.png','app.js','manifest.webmanifest','icon.svg'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(ASSETS.map(a=>cache.add(a)))));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

// רשת קודם, ואם אין חיבור - מהמטמון. כך עדכונים לקבצים מגיעים תמיד.
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(
    fetch(event.request)
      .then(response=>{
        if(response.ok&&new URL(event.request.url).origin===location.origin){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        }
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});

self.addEventListener('push',event=>{
  const data=event.data?.json()||{};
  event.waitUntil(self.registration.showNotification(data.title||'יומי',{
    body:data.body||'יש לך תזכורת חדשה',
    icon:'icon-180.png',dir:'rtl',lang:'he',
    tag:data.tag||undefined
  }));
});

// לחיצה על התראה פותחת את האפליקציה (או מחזירה אליה אם כבר פתוחה)
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
      for(const client of list){if('focus' in client)return client.focus();}
      return self.clients.openWindow('./');
    })
  );
});
