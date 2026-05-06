// This function will be converted to a string and injected into the
// instrumented code. Writing it as a real function allows using
// IDE features and makes it easier to maintain.

/** @typedef ContextState
 * @property {Map<string, { s: Array<number>, f: Array<number>, b: Array<Array<number>> }>} counters
 */

/**
 * @param {[string, any][]} shapes 
 */
export function preamble(shapes) {
  const sources = shapes.map(([path]) => path);

  // The first script to run in each Window or Worker creates the context
  // state for all the code that runs in the same Window or Worker.
  let isPrimary = false;
  // @ts-ignore
  if (!globalThis.__swic__) {
    isPrimary = true;

    // @ts-ignore
    globalThis.__swic__ = {
      counters: new Map()
    };
  }
  // @ts-ignore
  const contextState = /** @type {ContextState} */(globalThis.__swic__);

  // This convenience function inverts cvtCoverageMapToShape() in the
  // transpiler, reproducing the coverage map structure, except that it
  // replaces each file location with an initial count of 0.
  function cvtShapeToCoverageCounters(/** @type {any} */ shape) {
    return typeof shape === 'number' ?
      new Array(shape).fill(0) :
      shape.map((/** @type {any} */ child) => cvtShapeToCoverageCounters(child));
  }

  const scriptCounters = {
    /** @type {Array<Array<number>>} */ s: [],
    /** @type {Array<Array<number>>} */ f: [],
    /** @type {Array<Array<Array<number>>>} */ b: []
  };
  shapes.forEach(([path, shape], i) => {
    // Configure counters in the global state for this source file.
    const sourceCounters = {
      s: cvtShapeToCoverageCounters(shape.s),
      f: cvtShapeToCoverageCounters(shape.f),
      b: cvtShapeToCoverageCounters(shape.b)
    };
    contextState.counters.set(path, sourceCounters);

    // As an opimization, the transpiled code will increment the counters
    // by array index instead of a Map lookup.
    scriptCounters.s.push(sourceCounters.s);
    scriptCounters.f.push(sourceCounters.f);
    scriptCounters.b.push(sourceCounters.b);
  });

  // The primary script is responsible for saving the coverage counts
  // to IndexedDB.
  if (isPrimary) {
    // This convenience function adds the counts in possibly nested
    // arrays of the same "shape", storing the result in dst and
    // resetting src to zeros.
    function mergeCounts(/** @type {any} */ src, /** @type {any} */ dst) {
      if (typeof src[0] === 'number') {
        for (let i = 0; i < src.length; i++) {
          dst[i] += src[i];
          src[i] = 0;
        }
      } else {
        for (let i = 0; i < src.length; i++) {
          mergeCounts(src[i], dst[i]);
        }
      }
    }

    const dbPromise = openDB();
    async function saveCounts() {
      const db = await dbPromise;
      const tx = db.transaction('counts', 'readwrite');
      const countsStore = tx.objectStore('counts');

      // Loop over the source files instrumented in this context.
      const entries = Array.from(contextState.counters.entries());
      for (let i = 0; i < entries.length; i++) {
        // Fetch the existing counts for this file from IndexedDB.
        const [path, counters] = entries[i];
        const existing = await new Promise((resolve, reject) => {
          const request = countsStore.get(path);
          request.onsuccess = () => {
            if (request.result) {
              resolve(request.result);
            } else {
              // No existing counts, so create a new entry with zeros.
              resolve({
                path,
                s: cvtShapeToCoverageCounters(shapes[i][1].s),
                f: cvtShapeToCoverageCounters(shapes[i][1].f),
                b: cvtShapeToCoverageCounters(shapes[i][1].b)
              });
            }
          };
          request.onerror = () => reject(request.error);
        });

        // Merge counts and save back to IndexedDB.
        mergeCounts(counters.s, existing.s);
        mergeCounts(counters.f, existing.f);
        mergeCounts(counters.b, existing.b);
        countsStore.put(existing);
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
        tx.commit();
      });
    }

    // Save can be triggered either by a custom event or BroadcastChannel.
    globalThis.addEventListener('swic-save', event => {
      const customEvent = /** @type {CustomEvent} */(event);
      customEvent.detail.response = saveCounts();
    });
    new BroadcastChannel('swic-save').addEventListener('message', () => {
      saveCounts();
    });
  }
  return scriptCounters;
}

/**
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('swic', 1);
    request.onupgradeneeded = event => {
      const db = request.result;
      db.createObjectStore('maps', { keyPath: 'path' });
      db.createObjectStore('counts', { keyPath: 'path' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}