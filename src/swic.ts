/// <reference lib="webworker" />
import { buildPathMatcher as buildPathMatcher } from "./path";
import { transpile } from "./transpile";
import { openDB } from "./injected";

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
const dbPromise = openDB();

// Activate the newly installed worker immediately.
self.addEventListener("install", (event: ExtendableEvent) => {
	event.waitUntil(Promise.all([
    self.skipWaiting(),
    (async () => {
      // Clear the cache.
      const cache = await caches.open(CACHE_NAME);
      await cache.keys().then(keys => Promise.all(keys.map(key => cache.delete(key))));

      // Clear IndexedDB.
      const db = await dbPromise;
      const tx = db.transaction(['maps', 'counts'], 'readwrite');
      tx.objectStore('maps').clear();
      tx.objectStore('counts').clear();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.commit();
      });
    })()
  ]));
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
      const db = await dbPromise;
      const tx = db.transaction(['maps', 'counts'], 'readonly');
      const [maps, counts]: any[] = await Promise.all([
        new Promise((resolve, reject) => {
          const request = tx.objectStore('maps').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }),
        new Promise((resolve, reject) => {
          const request = tx.objectStore('counts').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        })
      ]);

      const mapPathToMaps = new Map(maps.map((map: any) => [map.path, map]));
      const entries = counts.map((count: any) => {
        const map: any = mapPathToMaps.get(count.path);
        const obj = {
          path: count.path,
          statementMap: cvtArrayToObject(map!.statementMap),
          fnMap: cvtArrayToObject(map!.fnMap),
          branchMap: cvtArrayToObject(map!.branchMap),
          s: cvtArrayToObject(count.s),
          f: cvtArrayToObject(count.f),
          b: cvtArrayToObject(count.b)
        };
        return [count.path, obj];
      });
      const obj = Object.fromEntries(entries);
      return new Response(JSON.stringify(obj), {
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

      // TODO: check cache for matching ETag

      // Instrument this script.
      const responseBytes = await response.arrayBuffer();
      const responseText = new TextDecoder().decode(responseBytes);
      const transpiled = await transpile(`.${requestUrl.pathname}`, responseText);

      // Persist coverage maps to IndexedDB.
      const db = await dbPromise;
      const tx = db.transaction('maps', 'readwrite');
      const mapsStore = tx.objectStore('maps');
      for (const [path, mapping] of transpiled.mapping) {
        mapsStore.put({
          path,
          statementMap: mapping.statementMap,
          fnMap: mapping.fnMap,
          branchMap: mapping.branchMap
        });
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
        tx.commit();
      });

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

      return new Response(transpiled.code, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.error(requestUrl.pathname, error);
      return new Response(null, {
        status: 500,
        statusText: 'Internal Server Error'
      });
    }
  })());
});

function cvtArrayToObject<T>(a: Array<T>): { [key: number]: T } {
  return Object.fromEntries(a.map((value, index) => [index + 1, value]));
}