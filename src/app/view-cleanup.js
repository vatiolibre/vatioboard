export function createCleanupStack() {
  const cleanups = [];
  let disposed = false;

  function runCleanup(cleanup) {
    try {
      cleanup();
    } catch {
      // Keep teardown best-effort so one stale listener never strands a route.
    }
  }

  function add(cleanup) {
    if (typeof cleanup !== "function") return cleanup;
    if (disposed) {
      runCleanup(cleanup);
      return cleanup;
    }
    cleanups.push(cleanup);
    return cleanup;
  }

  function addEventListener(target, type, listener, options) {
    if (!target) return;

    if (typeof target.addEventListener === "function") {
      target.addEventListener(type, listener, options);
      add(() => {
        target.removeEventListener(type, listener, options);
      });
      return;
    }

    if (typeof target.addListener !== "function") return;
    target.addListener(listener);
    add(() => {
      target.removeListener?.(listener);
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

  function addDisposable(object, methodName = "destroy") {
    if (!object || typeof object[methodName] !== "function") return object;
    add(() => {
      object[methodName]();
    });
    return object;
  }

  function run() {
    if (disposed) return;
    disposed = true;
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      runCleanup(cleanup);
    }
  }

  return {
    add,
    addEventListener,
    setTimeout: setTimeoutCleanup,
    setInterval: setIntervalCleanup,
    requestAnimationFrame: requestAnimationFrameCleanup,
    abortController,
    addDisposable,
    run,
  };
}
