/// <reference lib="webworker" />
import { buildPathMatcher as buildPathMatcher } from "./path";

declare const self: ServiceWorkerGlobalScope;

const config: { match: string[] } = Object.assign(
  { match: ['*.js', '!/**/node_modules/**'] },
  JSON.parse(new URLSearchParams(self.location.search).get("config") || "{}")
);

const pathMatcher = buildPathMatcher(config.match);

// Activate the newly installed worker immediately.
self.addEventListener("install", (event: ExtendableEvent) => {
	event.waitUntil(self.skipWaiting());
});

// Take control of existing pages as soon as this worker activates.
self.addEventListener("activate", (event: ExtendableEvent) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const requestUrl = new URL(event.request.url);

  // 
  if (event.request.headers.get('x-swic') === 'ping') {
    return event.respondWith(new Response(null, {
      status: 200,
      statusText: 'OK',
      headers: { 'x-swic': 'pong' }
    }));
  }

  if (!pathMatcher(requestUrl.pathname)) {
    return;
  }
  
  event.respondWith((async () => {
    const response = await fetch(event.request);

    // Opaque responses (e.g. some cross-origin requests) cannot be modified.
    if (response.type === "opaque") {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set("x-swic-service-worker", "active");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  })());
});
