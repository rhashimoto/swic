import { wrap } from "idb";

/** @import { CoverageMaps, CoverageCounts } from "./types/index" */

const dbPromise = openIDB().then(db => wrap(db));

const SOURCE_CACHE_NAME = 'swic-cache-sources';
const cachePromise = caches.open(SOURCE_CACHE_NAME);

/**
 * @returns {Promise<IDBDatabase>}
 */
export function openIDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('swic', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('maps', { keyPath: 'path' });
      db.createObjectStore('counts', { keyPath: 'path' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function clearDB() {
  const db = await dbPromise;
  const tx = db.transaction(db.objectStoreNames, 'readwrite');
  Array.from(db.objectStoreNames).forEach(storeName => {
    tx.objectStore(storeName).clear();
  });

  const cache = await cachePromise;
  cache.keys().then(keys => Promise.all(keys.map(key => cache.delete(key))));
}

/**
 * @returns {Promise<{ maps: CoverageMaps[], counts: CoverageCounts[] }>}
 */
export async function loadDataFromDB() {
  const db = await dbPromise;
  const storeNameArray = Array.from(db.objectStoreNames);
  const tx = db.transaction(storeNameArray, 'readonly');
  const objectEntries = await Promise.all(storeNameArray.map(storeName => {
    const store = tx.objectStore(storeName);
    return store.getAll().then(results => [storeName, results]);
  }));
  return Object.fromEntries(objectEntries);
}

/**
 * @param {Iterable<[string, CoverageMaps]>} maps
 */
export async function saveMapsToDB(maps) {
  const [db, cache] = await Promise.all([dbPromise, cachePromise]);

  // Determine if any of the source files have changed by comparing ETags.
  // If a file has changed, we'll need to reset its counts. This must be
  // done outside the IndexedDB transaction because asynchronous operations
  // for cache and fetch are required.
  const contentChanged = new Set();
  await Promise.all(Array.from(maps, async ([path]) => {
    // Get the cache entry for this path.
    const request = new Request(path);
    const cachedResponse = await cache.match(request);

    // Fetch the current ETag for the path.
    const response = await fetch(request, { method: 'HEAD' });
    if (response.ok) {
      const eTag = response.headers.get('ETag');
      if (eTag && eTag !== cachedResponse?.headers.get('ETag')) {
        // ETag changed, so mark this path's counts for reset.
        contentChanged.add(path);
        cache.put(request, response);
      }
    }
  }));

  // Save all the maps and reset counts as needed.
  const tx = db.transaction(['maps', 'counts'], 'readwrite');
  const mapsStore = tx.objectStore('maps');
  const countsStore = tx.objectStore('counts');
  for (const [path, mapping] of maps) {
    mapsStore.put({
      path,
      statementMap: mapping.statementMap,
      fnMap: mapping.fnMap,
      branchMap: mapping.branchMap
    });

    if (contentChanged.has(path)) {
      // Reset counts for modified file.
      countsStore.delete(path);
    }
  }
  await tx.done;

}
