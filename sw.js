/* Service worker: РѕС„Р»Р°Р№РЅ-РґРѕСЃС‚СѓРї Рё СѓСЃС‚Р°РЅРѕРІРєР° РЅР° С‚РµР»РµС„РѕРЅ.
   РЎС‚СЂР°С‚РµРіРёСЏ: СЃРµС‚СЊ РІ РїСЂРёРѕСЂРёС‚РµС‚Рµ, РєСЌС€ РєР°Рє Р·Р°РїР°СЃРЅРѕР№ РІР°СЂРёР°РЅС‚.
   РўР°Рє СЃРѕРґРµСЂР¶Р°РЅРёРµ РІСЃРµРіРґР° СЃРІРµР¶РµРµ, РЅРѕ РїРѕСЂС‚Р°Р» РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ Рё Р±РµР· РёРЅС‚РµСЂРЅРµС‚Р°. */

const VERSION = 'edu-v6';
const CORE = [
  './', './index.html', './plan.html', './tasks.html', './tracker.html',
  './olympiads.html', './projects.html', './clubs.html', './admission.html',
  './schools.html', './resources.html', './tests.html', './professions.html',
  './missions.html', './ai.html', './strategy.html', './setup.html', './my.html',
  './assets/css/style.css', './assets/js/app.js', './assets/js/sync.js',
  './assets/js/portal.js', './assets/js/coach.js', './assets/js/vendor/supabase.js',
  './assets/icon-192.png', './assets/icon-512.png',
  './manifest.webmanifest',
  './data/config.js', './data/sync-config.js', './data/deadlines.js', './data/olympiads.js', './data/olymp2.js',
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
