/* Offline support: app files cached on install, libraries/fonts cached on first use. */
const CACHE = "mms-v9";
const SHELL = [
  "./", "./index.html", "./css/styles.css", "./js/common.js", "./js/cert-engine.js", "./js/text-detect.js", "./js/certificates.js",
  "./js/vouchers.js", "./js/maker.js", "./js/voucher-docx.js", "./js/voucher-template-data.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin) {
    // network first so updates show up, cache when offline
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
    })));
  }
});
