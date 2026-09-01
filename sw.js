const CACHE_NAME = 'cuoti-cache-v1';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 预缓存核心文件
      return cache.addAll([
        './index.html',
        './manifest.json',
        './logo.png'
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  
  // 跨域请求（如 AI 接口、GitHub API）不拦截，直接放行
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    // 网络优先策略：确保代码更新能立刻生效
    fetch(event.request)
      .then(response => {
        const resClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        return response;
      })
      .catch(() => {
        // 无网络时使用缓存启动
        return caches.match(event.request);
      })
  );
});
