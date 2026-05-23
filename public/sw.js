const CACHE_NAME = 'linkvault-shell-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== 'linkvault-assets-v2') {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Intercept native PWA Web Share Target POST shares
  if (event.request.method === 'POST' && url.pathname === '/api/share') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const title = formData.get('title') || '';
          const text = formData.get('text') || '';
          const sharedUrl = formData.get('url') || '';
          
          // Extract matching URL
          const extractedUrl = sharedUrl || (text && text.match(/https?:\/\/[^\s]+/)?.[0]) || '';
          
          console.log('Service Worker: Captured shared link:', { title, text, sharedUrl, extractedUrl });
          
          if (extractedUrl) {
            // Redirect using standard 303 status so the shared URL is passed to App.tsx via query string
            return Response.redirect('/?share_url=' + encodeURIComponent(extractedUrl), 303);
          }
        } catch (err) {
          console.error('Service Worker share target parsing failed:', err);
        }
        return Response.redirect('/', 303);
      })()
    );
    return;
  }
  
  // Handle other fetch requests
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached shell or asset
        return cachedResponse;
      }
      
      return fetch(event.request).then((response) => {
        // Cache static JS/CSS and icons as they are loaded
        if (response && response.status === 200) {
          const isAsset = url.pathname.endsWith('.js') || 
                          url.pathname.endsWith('.css') || 
                          url.pathname.endsWith('.svg') || 
                          url.pathname.includes('/assets/') ||
                          url.pathname.includes('lucide');
          if (isAsset) {
            caches.open('linkvault-assets-v2').then((cache) => {
              cache.put(event.request, response.clone());
            });
          }
        }
        return response;
      }).catch(() => {
        // If offline and navigate request fails, return cached home shell
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
        return null;
      });
    })
  );
});
