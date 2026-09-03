const CACHE_NAME = "master-presenter-v2";

// Core application shell assets to cache for offline usage
const PRECACHE_URLS = [
  "/",
  "/present",
  "/manifest.json",
  "/GESTURE PRESENTER LOGO DESIGN.png",
  "/favicon.ico",
];

// Install: cache application shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up outdated caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: Network-first for dynamic content with robust cache fallback for offline execution
self.addEventListener("fetch", (event) => {
  // Only handle GET requests from http/https
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith("http")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for offline support
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() => {
        // When offline, match request from cache
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // For navigation requests, fallback to the cached shell
          if (event.request.mode === "navigate") {
            const url = new URL(event.request.url);
            if (url.pathname.startsWith("/present")) {
              return caches.match("/present").then((presentPage) => presentPage || caches.match("/"));
            }
            return caches.match("/");
          }
          return new Response("Offline", { status: 503, statusText: "Offline" });
        });
      })
  );
});
