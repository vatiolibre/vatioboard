import { startCloudSyncLoop } from '../shared/cloud-sync.js';
import { initPromise as routeInitPromise, mountReplayRoute } from './replay.js';

export { waitForReplaySelection } from './replay.js';

interface StandaloneRouteContext {
  root: Document;
  signal: AbortSignal | null;
}

type RouteMount = (routeContext: StandaloneRouteContext) => unknown;

interface StandaloneInitPromise extends PromiseLike<unknown> {
  catch<TResult = never>(
    onRejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<unknown | TResult>;
  finally(onFinally?: (() => void) | null): Promise<unknown>;
}

const mountStandaloneReplayRoute = mountReplayRoute as RouteMount;
const routeReadyPromise = routeInitPromise as PromiseLike<unknown>;

let standaloneMountPromise: Promise<unknown> | null = null;
let cloudSyncStarted = false;

function startStandaloneCloudSync(): void {
  if (cloudSyncStarted) return;
  cloudSyncStarted = true;
  startCloudSyncLoop({ immediate: true });
}

export function ensureStandaloneReplayMounted(): Promise<unknown> {
  if (!standaloneMountPromise) {
    const mountPromise = mountStandaloneReplayRoute({
      root: document,
      signal: null,
    });
    standaloneMountPromise = Promise.resolve(mountPromise).then(() => routeReadyPromise);
    startStandaloneCloudSync();
  }
  return standaloneMountPromise;
}

export const initPromise: StandaloneInitPromise = {
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
