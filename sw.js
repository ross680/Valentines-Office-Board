// Offline cache for the office TV. The shell is cached on install. Clip files are
// cached when they play, and the page also asks for the full playlist once the
// first frame is up. A later request with the same ?v= plays from this cache
// when the network is down. ?v= is part of the clip URL, so a new hash is a
// new entry. The bust/date query on the page is not part of the cache key.
// Cache names are origin-wide on github.io. Only this board's buckets are deleted.
var CACHE = "valentines-board-v1";
var SHELL = [
  "./",
  "./index.html",
  "./playlist.js?v=20261027a",
  "./styles.css?v=20261027a",
  "./app.js?v=20261027a"
];

function stableRequest(request) {
  var url = new URL(request.url);
  url.searchParams.delete("bust");
  url.searchParams.delete("date");
  url.searchParams.delete("debug");
  url.searchParams.delete("slide");
  url.searchParams.delete("fresh");
  url.searchParams.delete("stall");
  url.searchParams.delete("reload");
  url.searchParams.delete("maxclip");
  return url.toString();
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () {});
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.indexOf("valentines-board-") === 0 && key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("message", function (event) {
  var data = event.data || {};
  if (data.type !== "cache-clips" || !data.urls || !data.urls.length) return;
  event.waitUntil(cacheUrls(data.urls));
});

function cacheUrls(urls) {
  return caches.open(CACHE).then(function (cache) {
    var chain = Promise.resolve();
    urls.forEach(function (url) {
      chain = chain.then(function () {
        return cache.match(url).then(function (hit) {
          if (hit) return;
          return cache.add(url).catch(function () {});
        });
      });
    });
    return chain;
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith(".mp4")) {
    event.respondWith(clipResponse(request));
    return;
  }

  var key = stableRequest(request);
  event.respondWith(
    fetch(request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) {
        cache.put(key, copy);
      }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(key).then(function (hit) {
        return hit || caches.match("./index.html");
      });
    })
  );
});

function clipResponse(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (res && res.ok && res.status !== 206) cache.put(request, res.clone());
        return res;
      });
    });
  });
}
