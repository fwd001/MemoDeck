/* =========================================================
 * MemoDeck Service Worker
 * 离线缓存 + 安装更新 + stale-while-revalidate
 * 版本号变动会触发旧缓存自动清理
 * ========================================================= */

// ⚠️ 升级时必须与 config.js 中 APP_VERSION 保持同步！
//    SW 是独立 worker，无法访问 window.EXAM_CONFIG，故硬编码一份
const VERSION = "2.0.0";
const CACHE_NAME = `memodeck-v${VERSION}`;
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./config.js",
  "./default-bank.js",
  "./css/tokens.css",
  "./css/components.css",
  "./css/pages.css",
  "./css/responsive.css",
  "./css/themes.css",
  "./css/accessibility.css",
  "./js/app.js",
  "./js/core.js",
  "./js/leitner.js",
  "./js/wrongbook.js",
  "./js/store.js",
  "./js/utils.js",
  "./js/progress.js",
  "./js/session.js",
  "./js/stats.js",
  "./js/migration.js",
  "./js/ai-prompt.js",
  "./vendor/vue.global.prod.js",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

/* ---------- install: 预缓存 ---------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

/* ---------- activate: 清理旧缓存 ---------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ---------- fetch: 缓存优先 + stale-while-revalidate ---------- */
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 只处理同源 GET 请求
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML 页面：network-first，失败再回退缓存（保证每次打开是最新版）
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // 其他静态资源：cache-first，miss 再 fetch
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // 后台刷新
        fetch(req)
          .then((resp) => {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          })
          .catch(() => {});
        return cached;
      }
      return fetch(req)
        .then((resp) => {
          if (!resp || resp.status !== 200 || resp.type !== "basic") return resp;
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(() => cached);
    })
  );
});
