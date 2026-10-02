const CACHE = "controle-kits-v1-static";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/app.js",
  "./js/config.js",
  "./js/supabase.js",
  "./js/auth.js",
  "./js/localdb.js",
  "./js/db.js",
  "./js/sync.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k !== CACHE)
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (url.origin !== location.origin) return;

  // Arquivos que podem mudar durante o desenvolvimento:
  // sempre tenta buscar a versão atual primeiro.
  const networkFirst = [
    "./",
    "./index.html",
    "./js/app.js",
    "./js/config.js",
    "./js/supabase.js",
    "./js/auth.js",
    "./js/localdb.js",
    "./js/db.js",
    "./js/sync.js"
  ];

  const isNetworkFirst = networkFirst.includes(url.pathname);

  if (isNetworkFirst) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();

          caches.open(CACHE).then(c => {
            c.put(event.request, copy);
          });

          return response;
        })
        .catch(() => caches.match(event.request))
    );

    return;
  }

  // Demais arquivos: cache-first.
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached ||
      fetch(event.request)
        .then(response => {
          const copy = response.clone();

          caches.open(CACHE).then(c => {
            c.put(event.request, copy);
          });

          return response;
        })
        .catch(() => caches.match("./index.html"))
    )
  );
});
