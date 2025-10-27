const CACHE_NAME = "99vs1-cache-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/game.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

const updateCache = (request, response) => {
  if (!response || response.status !== 200 || (response.type !== "basic" && response.type !== "cors")) {
    return;
  }

  const responseToCache = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
};

const networkFirst = async (request) => {
  try {
    const networkResponse = await fetch(request, { cache: "reload" });
    updateCache(request, networkResponse);
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request, { ignoreSearch: true });
    if (cachedResponse) {
      return cachedResponse;
    }
    return caches.match("/index.html");
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        event.waitUntil(
          fetch(event.request, { cache: "no-store" })
            .then((networkResponse) => updateCache(event.request, networkResponse))
            .catch(() => undefined),
        );
        return cachedResponse;
      }

      return fetch(event.request, { cache: "no-store" })
        .then((networkResponse) => {
          updateCache(event.request, networkResponse);
          return networkResponse;
        })
        .catch(() => {
          if (event.request.mode === "navigate") {
            return caches.match("/index.html");
          }
          return caches.match("/");
        });
    }),
  );
});
