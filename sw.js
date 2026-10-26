/* Piano Repertoire Keeper — service worker
   Place this file next to index.html in your repo root as "sw.js".
   Caching strategy:
   - App shell (index.html): network-first with cache fallback (updates arrive,
     offline always works)
   - PDF.js CDN files: cache-first (cached once on first sheet view)
   - Drive/API traffic: network only (never cached here; sheet PDFs are cached
     by the app itself in "prk-sheets-v1")
*/
const VERSION = "prk-shell-v1";
const CDN = [
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(["./", "./index.html"]);       // app shell: must succeed
    await cache.addAll(CDN).catch(() => {});           // PDF.js: best effort
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION && k !== "prk-sheets-v1")
      .map(k => caches.delete(k)));                    // keep sheet cache!
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Google APIs: network only (auth + JSON data go through fetch, not cache)
  if (url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("google.com") ||
      url.hostname.endsWith("googleusercontent.com")) return;

  // PDF.js CDN: cache-first
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put(req, r.clone());
        return r;
      } catch { return new Response("", { status: 504 }); }
    })());
    return;
  }

  // Page navigations: network-first, cache fallback (works fully offline)
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put(req, r.clone());
        return r;
      } catch {
        return (await caches.match(req)) ||
               (await caches.match("./index.html")) ||
               (await caches.match("./")) ||
               new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // Same-origin assets: stale-while-revalidate
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      const refresh = fetch(req).then(r => {
        caches.open(VERSION).then(c => c.put(req, r.clone()));
        return r;
      }).catch(() => hit);
      return hit || refresh;
    })());
  }
});
