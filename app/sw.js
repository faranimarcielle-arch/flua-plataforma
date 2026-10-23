// FLUA service worker: makes the platform installable and keeps the last version of each page for weak connections.
// Network first, so students always get the newest version when online. Only this site's own files are cached:
// requests to Supabase, the AI and other sites are never touched.
const CACHE = "flua-v2";
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>FLUA</title><p style='font-family:sans-serif;padding:24px'>Sem internet no momento. Conecte-se e tente de novo.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })))
  );
});
