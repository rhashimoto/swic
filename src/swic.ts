/// <reference lib="webworker" />
import { buildPathMatcher as buildPathMatcher } from "./path";
import { transpile } from "./transpile";
import { clearDB, loadDataFromDB, saveMapsToDB } from "./persistence";
import { formatIstanbul } from "./format";

declare const self: ServiceWorkerGlobalScope;

const DEFAULT_CONFIG = {
  match: ['*.js', '!/**/node_modules/**']
};
const CACHE_NAME = 'swic-cache-v1';

// Load configuration from query parameter "config" as JSON.
const config: { match: string[] } = Object.assign(
  DEFAULT_CONFIG,
  JSON.parse(new URLSearchParams(location.search).get("config") || "{}")
);

const pathMatcher = buildPathMatcher(config.match);
const cachePromise = caches.open(CACHE_NAME);

// Activate the newly installed worker immediately.
self.addEventListener("install", (event: ExtendableEvent) => {
  self.skipWaiting();
	event.waitUntil(
    (async () => {
      // Clear the cache.
      const cache = await cachePromise;
      await cache.keys().then(keys => Promise.all(keys.map(key => cache.delete(key))));

      // Clear IndexedDB.
      await clearDB();
    })()
  );
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

  // Handle coverage report requests.
  const requestUrl = new URL(event.request.url);
  if (requestUrl.searchParams.has('swic-coverage')) {
    return event.respondWith((async () => {
      // Load coverage data from IndexedDB.
      const data = await loadDataFromDB();

      // Return coverage report in Istanbul format.
      const report = await formatIstanbul(data as any);
      return new Response(JSON.stringify(report), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' }
      });
    })());
  }

  // Ignore other requests that don't match the configured patterns.
  if (!pathMatcher(requestUrl.pathname)) {
    return;
  }
  
  // Transpile matching requests.
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (!response.ok) {
        return response;
      }

      // Ensure the response is JavaScript before trying to transpile it.
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('javascript')) {
        console.warn(`Skipping ${requestUrl.pathname}: content-type is ${contentType}`);
        return response;
      }

      // If there is a cached response with the same ETag, return it
      // without transpiling.
      const cache = await cachePromise;
      const fetchedETag = response.headers.get('etag');
      if (fetchedETag) {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse && cachedResponse.headers.get('etag') === fetchedETag) {
          return cachedResponse;
        }
      }
      
      // Instrument this script.
      const responseBytes = await response.arrayBuffer();
      const responseText = new TextDecoder().decode(responseBytes);
      const transpiled = await transpile(requestUrl, responseText);

      // Persist coverage maps to IndexedDB.
      await saveMapsToDB(transpiled.mapping);

      // Remove headers that may be invalid after instrumentation.
      const headers = new Headers(response.headers);
      headers.delete('Content-Length');
      headers.delete('Content-Encoding');
      headers.delete('Content-Range');
      headers.delete('Last-Modified');
      headers.delete('Digest');
      headers.delete('Content-Digest');
      headers.delete('Repr-Digest');
      headers.delete('Content-MD5');

      const transpiledResponse = new Response(transpiled.code, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

      // Add response to cache.
      await cache.put(event.request, transpiledResponse.clone());

      return transpiledResponse;
    } catch (error) {
      console.error(requestUrl.pathname, error);
      return new Response(null, {
        status: 500,
        statusText: 'Internal Server Error'
      });
    }
  })());
});
