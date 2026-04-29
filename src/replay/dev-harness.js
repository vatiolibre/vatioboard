import { startCloudSyncLoop } from '../shared/cloud-sync.js';
import { initPromise as routeInitPromise, mountReplayRoute } from './replay.js';

export { waitForReplaySelection } from './replay.js';

let standaloneMountPromise = null;
let cloudSyncStarted = false;

function startStandaloneCloudSync() {
  if (cloudSyncStarted) return;
  cloudSyncStarted = true;
  startCloudSyncLoop({ immediate: true });
}

export function ensureStandaloneReplayMounted() {
  if (!standaloneMountPromise) {
    const mountPromise = mountReplayRoute({
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
    return ensureStandaloneReplayMounted().then(onFulfilled, onRejected);
  },
  catch(onRejected) {
    return ensureStandaloneReplayMounted().catch(onRejected);
  },
  finally(onFinally) {
    return ensureStandaloneReplayMounted().finally(onFinally);
  },
};

void ensureStandaloneReplayMounted();
