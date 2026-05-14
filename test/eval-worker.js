import * as Comlink from 'comlink';

Comlink.expose(function(/** @type {string} */ source) {
  return eval(source);
});