/* Service worker: офлайн-доступ и установка на телефон.
   Стратегия: сеть в приоритете, кэш как запасной вариант.
   Так содержание всегда свежее, но портал открывается и без интернета. */

const VERSION = 'edu-v4';
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
    // addAll падает целиком, если хоть один файл недоступен — кладём по одному
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
  // календарь всегда только из сети
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
