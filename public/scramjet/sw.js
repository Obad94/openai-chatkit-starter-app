importScripts('/scram/scramjet.all.js');

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function withIsolationHeaders(response) {
  if (!response) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleRequest(event) {
  const url = new URL(event.request.url);
  if (url.pathname === '/scramjet/' || url.pathname === '/scramjet') {
    return withIsolationHeaders(await fetch(event.request));
  }

  await scramjet.loadConfig();
  try {
    if (scramjet.route(event)) {
      const response = await scramjet.fetch(event);
      return withIsolationHeaders(response);
    }
  } catch (error) {
    console.error('Scramjet proxy fetch failed', error);
  }
  const fallback = await fetch(event.request);
  return withIsolationHeaders(fallback);
}

self.addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event));
});
