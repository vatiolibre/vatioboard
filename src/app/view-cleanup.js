export function createCleanupStack() {
  const cleanups = [];
  let disposed = false;

  function add(cleanup) {
    if (typeof cleanup !== "function") return cleanup;
    if (disposed) {
      cleanup();
      return cleanup;
    }
    cleanups.push(cleanup);
    return cleanup;
  }

  function addEventListener(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, listener, options);
    add(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  function run() {
    if (disposed) return;
    disposed = true;
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      try {
        cleanup();
      } catch {
        // Keep teardown best-effort so one stale listener never strands a route.
      }
    }
  }

  return {
    add,
    addEventListener,
    run,
  };
}
