/* Service worker: РѕС„Р»Р°Р№РЅ-РґРѕСЃС‚СѓРї Рё СѓСЃС‚Р°РЅРѕРІРєР° РЅР° С‚РµР»РµС„РѕРЅ.
   РЎС‚СЂР°С‚РµРіРёСЏ: СЃРµС‚СЊ РІ РїСЂРёРѕСЂРёС‚РµС‚Рµ, РєСЌС€ РєР°Рє Р·Р°РїР°СЃРЅРѕР№ РІР°СЂРёР°РЅС‚.
   РўР°Рє СЃРѕРґРµСЂР¶Р°РЅРёРµ РІСЃРµРіРґР° СЃРІРµР¶РµРµ, РЅРѕ РїРѕСЂС‚Р°Р» РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ Рё Р±РµР· РёРЅС‚РµСЂРЅРµС‚Р°. */

const VERSION = 'edu-v8';
const CORE = [
  './', './index.html', './plan.html', './tasks.html', './tracker.html',
  './olympiads.html', './projects.html', './clubs.html', './admission.html',
  './schools.html', './resources.html', './tests.html', './professions.html',
  './missions.html', './ai.html', './strategy.html', './setup.html', './my.html',
  './assets/css/style.css', './assets/js/app.js', './assets/js/sync.js',
  './assets/js/portal.js', './assets/js/coach.js', './assets/js/vendor/supabase.js',
  './assets/icon-192.png', './assets/icon-512.png',
  './manifest.webmanifest',
  './data/config.js', './data/push-config.js', './data/sync-config.js', './data/deadlines.js', './data/olympiads.js', './data/olymp2.js',
  './data/resources.js', './data/plans.js', './data/prompts.js', './data/tests.js',
  './data/tasks.js', './data/professions.js', './data/missions.js',
  './data/projects.js', './data/schools.js', './data/clubs.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // addAll РїР°РґР°РµС‚ С†РµР»РёРєРѕРј, РµСЃР»Рё С…РѕС‚СЊ РѕРґРёРЅ С„Р°Р№Р» РЅРµРґРѕСЃС‚СѓРїРµРЅ вЂ” РєР»Р°РґС‘Рј РїРѕ РѕРґРЅРѕРјСѓ
    await Promise.all(CORE.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // РєР°Р»РµРЅРґР°СЂСЊ РІСЃРµРіРґР° С‚РѕР»СЊРєРѕ РёР· СЃРµС‚Рё
  if (url.pathname.endsWith('.ics')) return;

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const c = await caches.open(VERSION);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const home = await caches.match('./index.html');
        if (home) return home;
      }
      throw err;
    }
  })());
});

/* ---------- Web Push: показать уведомление и открыть нужную страницу ----------
   Edge Function send-reminders шлёт JSON {title, body, url}. Без этого
   обработчика доставленный push не показывается вообще. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (err) { d = { body: e.data ? e.data.text() : '' }; }

  const title = d.title || 'Образование';
  const opts = {
    body: d.body || '',
    icon: './assets/icon-192.png',
    badge: './assets/icon-192.png',
    tag: d.tag || ('edu-' + (d.body || title)),   // одинаковые не плодятся
    renotify: false,
    data: { url: d.url || './my.html' },
    requireInteraction: false,
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './my.html';
  e.waitUntil((async () => {
    const url = new URL(target, self.location.href).href;
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url === url && 'focus' in w) return w.focus();
    }
    for (const w of wins) {                        // уже открытый портал — просто переводим
      if (w.url.startsWith(self.registration.scope) && 'navigate' in w) {
        await w.navigate(url); return w.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
