import { startCloudSyncLoop } from '../shared/cloud-sync.js';
import { initPromise as routeInitPromise, mountSpeedRoute } from './speed.js';

let standaloneMountPromise = null;
let cloudSyncStarted = false;

function startStandaloneCloudSync() {
  if (cloudSyncStarted) return;
  cloudSyncStarted = true;
  startCloudSyncLoop({ immediate: true });
}

export function ensureStandaloneSpeedMounted() {
  if (!standaloneMountPromise) {
    const mountPromise = mountSpeedRoute({
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
    return ensureStandaloneSpeedMounted().then(onFulfilled, onRejected);
  },
  catch(onRejected) {
    return ensureStandaloneSpeedMounted().catch(onRejected);
  },
  finally(onFinally) {
    return ensureStandaloneSpeedMounted().finally(onFinally);
  },
};

void ensureStandaloneSpeedMounted();
