/// <reference lib="webworker" />
import { buildPathMatcher as buildPathMatcher } from "./path";
import { transpile } from "./transpile";

declare const self: ServiceWorkerGlobalScope;

const DEFAULT_CONFIG = {
  match: ['*.js', '!/**/node_modules/**']
};

// Load configuration from query parameter "config" as JSON.
const config: { match: string[] } = Object.assign(
  DEFAULT_CONFIG,
  JSON.parse(new URLSearchParams(location.search).get("config") || "{}")
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
  // Answer ping requests.
  if (event.request.headers.get('x-swic') === 'ping') {
    return event.respondWith(new Response(null, {
      status: 200,
      statusText: 'OK',
      headers: { 'x-swic': 'pong' }
    }));
  }

  // Ignore other requests that don't match the configured patterns.
  const requestUrl = new URL(event.request.url);
  if (!pathMatcher(requestUrl.pathname)) {
    return;
  }
  
  // Transpile matching requests.
  event.respondWith((async () => {
    const response = await fetch(event.request);

    // Opaque responses (e.g. some cross-origin requests) cannot be modified.
    if (response.type === "opaque") {
      return response;
    }

    const responseBytes = await response.arrayBuffer();
    const transpiled = await transpile(requestUrl.pathname, responseBytes);

    // Remove headers that may be invalid after instrumentation.
    const headers = new Headers(response.headers);
    headers.delete('Content-Length');
    headers.delete('Content-Encoding');
    headers.delete('Content-Range');
    headers.delete('ETag');
    headers.delete('Last-Modified');
    headers.delete('Digest');
    headers.delete('Content-Digest');
    headers.delete('Repr-Digest');
    headers.delete('Content-MD5');

    return new Response(transpiled, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  })());
});
