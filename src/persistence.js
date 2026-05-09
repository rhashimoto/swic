import { wrap } from "idb";

/** @import { CoverageMaps, CoverageCounts } from "./types/index" */

const dbPromise = openIDB().then(db => wrap(db));

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
  await tx.done;
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
  const db = await dbPromise;
  const tx = db.transaction(['maps'], 'readwrite');
  const store = tx.objectStore('maps');
  for (const [path, mapping] of maps) {
    store.put({
      path,
      statementMap: mapping.statementMap,
      fnMap: mapping.fnMap,
      branchMap: mapping.branchMap
    });
  }
  await tx.done;
}
