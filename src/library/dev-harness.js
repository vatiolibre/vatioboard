import { initPromise as routeInitPromise, mountLibraryRoute } from './library.js';

let standaloneMountPromise = null;

export function ensureStandaloneLibraryMounted() {
  if (!standaloneMountPromise) {
    const mountPromise = mountLibraryRoute({
      root: document,
      signal: null,
    });
    standaloneMountPromise = Promise.resolve(mountPromise).then(() => routeInitPromise);
  }
  return standaloneMountPromise;
}

export const initPromise = {
  then(onFulfilled, onRejected) {
    return ensureStandaloneLibraryMounted().then(onFulfilled, onRejected);
  },
  catch(onRejected) {
    return ensureStandaloneLibraryMounted().catch(onRejected);
  },
  finally(onFinally) {
    return ensureStandaloneLibraryMounted().finally(onFinally);
  },
};

void ensureStandaloneLibraryMounted();
