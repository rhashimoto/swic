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

/**
 * Gets all entries from the specified object stores in an IndexedDB database.
 * @param {IDBDatabase} db 
 * @param {string[]|DOMStringList} storeNames 
 * @returns {Promise<{[storeName: string]: any[]}>}
 */
export async function getAllFromIDB(db, storeNames = db.objectStoreNames) {
  const storeNameArray = Array.from(storeNames);
  const tx = db.transaction(storeNameArray, 'readonly');
  const objectEntries = await Promise.all(storeNameArray.map(storeName => {
    const store = tx.objectStore(storeName);
    return idbPromise(store.getAll()).then(results => [storeName, results]);
  }));
  return Object.fromEntries(objectEntries);
}

/**
 * Wraps an IndexedDB request or transaction in a Promise.
 * 
 * @param {IDBRequest|IDBOpenDBRequest|IDBTransaction} idbTarget
 * @param {{[key: string]: Function}} [handlers={}]
 * @returns {Promise<any>}
 * @throws {Error}
 */
export function idbPromise(idbTarget, handlers = {}) {
  return new Promise((resolve, reject) => {
    Object.keys(handlers).forEach(handlerName => {
      if (!(handlerName in idbTarget)) {
        throw new Error(`${handlerName} not supported on ${idbTarget.constructor.name}`);
      }
    });

    // Start with any provided handlers.
    Object.assign(idbTarget, handlers);

    // Overwrite handlers for Promise resolve/reject.
    if (idbTarget instanceof IDBTransaction) {
      idbTarget.oncomplete = (event) => {
        handlers.oncomplete?.(event);
        resolve(event); 
      };
      idbTarget.onabort = (event) => {
        handlers.onabort?.(event);
        reject(idbTarget.error || new Error("Transaction aborted"));
      };
      idbTarget.commit();
    } else {
      // IDBRequest or IDBOpenDBRequest
      idbTarget.onsuccess = (event) => {
        handlers.onsuccess?.(event);
        resolve(idbTarget.result);
      };
    }

    idbTarget.onerror = (event) => {
      handlers.onerror?.(event);
      reject(idbTarget.error);
    };
  });
}
