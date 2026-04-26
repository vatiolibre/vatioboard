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

  function setTimeoutCleanup(callback, delay, ...args) {
    const timeoutId = window.setTimeout(callback, delay, ...args);
    add(() => {
      window.clearTimeout(timeoutId);
    });
    return timeoutId;
  }

  function setIntervalCleanup(callback, delay, ...args) {
    const intervalId = window.setInterval(callback, delay, ...args);
    add(() => {
      window.clearInterval(intervalId);
    });
    return intervalId;
  }

  function requestAnimationFrameCleanup(callback) {
    const frameId = window.requestAnimationFrame(callback);
    add(() => {
      window.cancelAnimationFrame(frameId);
    });
    return frameId;
  }

  function abortController() {
    const controller = new AbortController();
    add(() => {
      controller.abort();
    });
    return controller;
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
    setTimeout: setTimeoutCleanup,
    setInterval: setIntervalCleanup,
    requestAnimationFrame: requestAnimationFrameCleanup,
    abortController,
    run,
  };
}
