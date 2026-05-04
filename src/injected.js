// This function will be converted to a string and injected into the
// instrumented code. Writing it as a real function allows using
// IDE features and makes it easier to maintain.

/** @typedef ContextState
 * @property {Set<string>} sources
 * @property {Array<ScriptState>} scriptStates
 */

/** @typedef ScriptState
 * @property {Map<string, number>} mapPathToIndex
 * @property {Array<Array<number>>} s
 * @property {Array<Array<number>>} f
 * @property {Array<Array<Array<number>>>} b
 */

/**
 * @param {string[]} sources 
 */
export function preamble(sources) {
  // The first script to run in each Window or Worker creates the context
  // state for all the code that runs in the same Window or Worker.
  let isPrimary = false;
  // @ts-ignore
  if (!globalThis.__swic__) {
    isPrimary = true;

    // @ts-ignore
    globalThis.__swic__ = {
      sources: new Set(sources),
      scriptStates: []
    };
  }

  // @ts-ignore
  const contextState = /** @type {ContextState} */(globalThis.__swic__);
  sources.forEach(source => contextState.sources.add(source));

  // A script corresponds to a JavaScript file fetched via the service
  // worker. Each script *may* be the result of transpiling multiple
  // source files, in which case a source map can be used to distinguish
  // them.
  /** @type {ScriptState} */
  const scriptState = {
    /** @type {Map<string, number>} */
    mapPathToIndex: new Map(sources.map((source, index) => [source, index])),
 
    // Coverage counters for statements, functions, and branches.
    /** @type {Array<Array<number>>} */ s: Array(sources.length).fill([]),
    /** @type {Array<Array<number>>} */ f: Array(sources.length).fill([]),
    /** @type {Array<Array<Array<number>>>} */ b: Array(sources.length).fill([]),
  };
  contextState.scriptStates.push(scriptState);

  if (isPrimary) {
    for (const source of contextState.sources) {
      for (const scriptState of contextState.scriptStates) {
        const index = scriptState.mapPathToIndex.get(source);
        if (index !== undefined) {
        }
      }
    }

    // const dbPromise = openDB();
    globalThis.addEventListener('swic-save', event => {
      const customEvent = /** @type {CustomEvent} */(event);

    //    customEvent.detail.response = dbPromise.then(db => {
    //   });
    });
  }
  return scriptState;
}

/**
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('swic', 1);
    request.onupgradeneeded = event => {
      const db = request.result;
      db.createObjectStore('files');
      db.createObjectStore('sources');
      db.createObjectStore('counts');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}