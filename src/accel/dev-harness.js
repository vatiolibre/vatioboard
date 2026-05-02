import { startCloudSyncLoop } from '../shared/cloud-sync.js';
import { initPromise as routeInitPromise, mountAccelRoute } from './accel.js';

let standaloneMountPromise = null;
let cloudSyncStarted = false;

function startStandaloneCloudSync() {
  if (cloudSyncStarted) return;
  cloudSyncStarted = true;
  startCloudSyncLoop({ immediate: true });
}

export function ensureStandaloneAccelMounted() {
  if (!standaloneMountPromise) {
    const mountPromise = mountAccelRoute({
      root: document,
      signal: null,
    });
    standaloneMountPromise = Promise.resolve(mountPromise).then(() => routeInitPromise);
    startStandaloneCloudSync();
  }
  return standaloneMountPromise;
}

export const initPromise = {
  then(onFulfilled, onRejected) {
    return ensureStandaloneAccelMounted().then(onFulfilled, onRejected);
  },
  catch(onRejected) {
    return ensureStandaloneAccelMounted().catch(onRejected);
  },
  finally(onFinally) {
    return ensureStandaloneAccelMounted().finally(onFinally);
  },
};

void ensureStandaloneAccelMounted();
