import { initPromise as routeInitPromise, mountLibraryRoute } from './library.js';

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

const mountStandaloneLibraryRoute = mountLibraryRoute as RouteMount;
const routeReadyPromise = routeInitPromise as PromiseLike<unknown>;

let standaloneMountPromise: Promise<unknown> | null = null;

export function ensureStandaloneLibraryMounted(): Promise<unknown> {
  if (!standaloneMountPromise) {
    const mountPromise = mountStandaloneLibraryRoute({
      root: document,
      signal: null,
    });
    standaloneMountPromise = Promise.resolve(mountPromise).then(() => routeReadyPromise);
  }
  return standaloneMountPromise;
}

export const initPromise: StandaloneInitPromise = {
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
