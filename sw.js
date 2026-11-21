/* 2027日历 service worker — static, cache-first, relative URLs */
const CACHE = "cal2027-xz-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./data/calendar-data.json",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/hero-01.jpg",
  "./icons/hero-02.jpg",
  "./icons/hero-03.jpg",
  "./icons/hero-04.jpg",
  "./icons/hero-05.jpg",
  "./icons/hero-06.jpg",
  "./icons/hero-07.jpg",
  "./icons/hero-08.jpg",
  "./icons/hero-09.jpg",
  "./icons/hero-10.jpg",
  "./icons/hero-11.jpg",
  "./icons/hero-12.jpg",
  "./icons/hero-13.jpg",
  "./icons/hero-14.jpg",
  "./icons/card-01.jpg",
  "./icons/card-02.jpg",
  "./icons/card-03.jpg",
  "./icons/card-04.jpg",
  "./icons/card-05.jpg",
  "./icons/card-06.jpg",
  "./icons/card-07.jpg",
  "./icons/card-08.jpg",
  "./icons/card-09.jpg",
  "./icons/card-10.jpg",
  "./icons/card-11.jpg",
  "./icons/card-12.jpg",
  "./icons/card-13.jpg",
  "./icons/card-14.jpg",
  "./widget.html",
  "./css/widget.css",
  "./js/widget.js",
  "./icons/widget-01.jpg",
  "./icons/widget-02.jpg",
  "./icons/widget-05.jpg",
  "./icons/widget-06.jpg",
  "./icons/widget-07.jpg",
  "./icons/widget-09.jpg",
  "./icons/widget-12.jpg",
  "./icons/widget-13.jpg",
  "./icons/widget-14.jpg",
  "./company-2027.ics"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
