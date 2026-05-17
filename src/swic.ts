/// <reference lib="webworker" />
import { type Config } from "./types";
import { buildPathMatcher as buildPathMatcher } from "./path";
import { transpile } from "./transpile";
import { clearDB, getConfig, loadDataFromDB, putConfig, saveMapsToDB } from "./persistence";
import { formatIstanbul } from "./format";

declare const self: ServiceWorkerGlobalScope;

const VIRTUAL_ORIGIN = 'https://swic.test';
const CACHE_NAME = 'swic-cache-v1';

let config: Config|undefined;
let pathMatcher: ((path: string) => boolean)|undefined;
(async function() {
  config = await getConfig();
  if (config) {
    pathMatcher = buildPathMatcher(config.match);
  }
})();

const cachePromise = caches.open(CACHE_NAME);

// Activate the newly installed worker immediately.
self.addEventListener("install", (event: ExtendableEvent) => {
  self.skipWaiting();
});

// Take control of existing pages as soon as this worker activates.
self.addEventListener("activate", (event: ExtendableEvent) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (url.origin === VIRTUAL_ORIGIN) {
    return event.respondWith((async () => {
      try {
        return handleVirtualRequest(event, url);
      } catch (e: any) {
        return new Response(e?.stack, {
          status: 500,
          statusText: 'Internal Server Error'
        });
      }
    })());
  }

  // Check for fast exit if there is a valid configuration.
  if (config?.isEnabled === false || pathMatcher?.(url.pathname) === false) {
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (!response.ok) {
        return response;
      }

      // Ensure the response is JavaScript.
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('javascript')) {
        console.warn(`Skipping ${url.pathname}: content-type is ${contentType}`);
        return response;
      }

      // Check the file path against the configued patterns.
      config = config || await getConfig();
      if (!config || !pathMatcher?.(url.pathname)) {
        return response;
      }

      // If there is a cached response with the same ETag, return it
      // without transpiling.
      const cache = await cachePromise;
      const fetchedETag = response.headers.get('etag');
      if (fetchedETag) {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse && cachedResponse.headers.get('etag') === fetchedETag) {
          // return cachedResponse;
        }
      }
      
      // Instrument this script.
      const responseBytes = await response.arrayBuffer();
      const responseText = new TextDecoder().decode(responseBytes);
      const transpiled = await transpile(url, responseText);

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
      console.error(url.pathname, error);
      return new Response(null, {
        status: 500,
        statusText: 'Internal Server Error'
      });
    }
  })());
});

async function handleVirtualRequest(event: FetchEvent, url: URL): Promise<Response> {
  switch (url.pathname) {
    case '/ping':
      return new Response(null, {
        status: 200,
        statusText: 'OK',
        headers: { 'x-swic': 'pong' }
      });

    case '/config':
      if (event.request.method === 'POST') {
        config = await event.request.json();
        if (config) {
          await putConfig(config);
          pathMatcher = buildPathMatcher(config.match);
        }
        return new Response(null, {
          status: 200,
          statusText: 'OK'
        });
      } else {
        return new Response(JSON.stringify(config), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' }
        });
      }

    case '/coverage':
      if (event.request.method === 'GET') {
        const data = await loadDataFromDB();
        const report = await formatIstanbul(data as any);
        return new Response(JSON.stringify(report), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' }
        });
      } else if (event.request.method === 'DELETE') {
        const cache = await cachePromise;
        await cache.keys().then(keys => Promise.all(keys.map(key => cache.delete(key))));
        await clearDB();
        return new Response(null, {
          status: 200,
          statusText: 'OK'
        });
      } else {
        return new Response(null, {
          status: 405,
          statusText: 'Method Not Allowed'
        });
      }

    default:
      return new Response(null, {
        status: 404,
        statusText: 'Not Found'
      });
  }
}