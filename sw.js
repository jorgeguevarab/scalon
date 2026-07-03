const CACHE_NAME = 'escalon-v2';
const APP_SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Records that a reminder actually fired today, in an IndexedDB mailbox the
// page drains on load/foreground (see drainFiredReminders in index.html) —
// the service worker has no access to localStorage, so this is how a push
// that arrives while the app is fully closed still shows up in Avisos later,
// instead of the "Recordatorios" list being a static readout of configured times.
function recordReminderFired(habitId) {
  return new Promise((resolve) => {
    const req = indexedDB.open('escalon-notify', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('fired', { keyPath: 'key' });
    req.onsuccess = () => {
      const db = req.result;
      const date = new Date();
      const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      const tx = db.transaction('fired', 'readwrite');
      tx.objectStore('fired').put({ key: `${habitId}_${dateStr}`, habitId, date: dateStr, ts: Date.now() });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    };
    req.onerror = () => resolve();
  });
}

self.addEventListener('push', (event) => {
  let payload = { title: 'Escalón', body: 'Tienes un hábito pendiente hoy.' };
  if (event.data) {
    try { payload = { ...payload, ...event.data.json() }; }
    catch (e) { payload.body = event.data.text(); }
  }
  const habitId = payload.data && payload.data.habitId;
  event.waitUntil((async () => {
    if (habitId) await recordReminderFired(habitId);
    await self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag || 'escalon-reminder',
      data: payload.data || {},
      renotify: false,
    });
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clientsList.forEach((c) => c.postMessage({ type: 'reminder-fired', habitId }));
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const habitId = event.notification.data && event.notification.data.habitId;
  const scope = self.registration.scope;
  const targetUrl = habitId ? `${scope}?habit=${encodeURIComponent(habitId)}` : scope;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (client.url.startsWith(scope) && 'focus' in client) {
          await client.focus();
          if (habitId) client.postMessage({ type: 'open-habit', habitId });
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
