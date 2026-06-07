import type {
  VatioAppLifecycleDiagnostics,
  VatioAppLifecycleLogEntry,
  VatioAppLifecycleRuntime,
  VatioAppLifecycleState,
} from "./types";

const MAX_LIFECYCLE_LOG_ENTRIES = 40;

export function createAppLifecycle(initialState: VatioAppLifecycleState = "registered"): VatioAppLifecycleRuntime {
  let state = initialState;
  const listeners = new Set<(state: VatioAppLifecycleState) => void>();
  const createdAt = new Date().toISOString();
  let mountedAt: string | null = null;
  let activatedAt: string | null = null;
  let lastStateChangeAt = createdAt;
  const log: VatioAppLifecycleLogEntry[] = [{
    state,
    at: createdAt,
  }];

  function setState(nextState: VatioAppLifecycleState) {
    const changedAt = new Date().toISOString();
    state = nextState;
    lastStateChangeAt = changedAt;
    if (nextState === "mounted") mountedAt = changedAt;
    if (nextState === "active") activatedAt = changedAt;
    log.push({ state, at: changedAt });
    if (log.length > MAX_LIFECYCLE_LOG_ENTRIES) {
      log.splice(0, log.length - MAX_LIFECYCLE_LOG_ENTRIES);
    }
    for (const listener of listeners) listener(state);
    return state;
  }

  return {
    getState() {
      return state;
    },
    mount() {
      return setState("mounted");
    },
    unmount() {
      return setState("unmounted");
    },
    activate() {
      return setState("active");
    },
    deactivate() {
      return setState("inactive");
    },
    suspend() {
      return setState("suspended");
    },
    resume() {
      return setState("active");
    },
    getDiagnostics(): VatioAppLifecycleDiagnostics {
      return {
        state,
        createdAt,
        mountedAt,
        activatedAt,
        lastStateChangeAt,
        log: log.slice(),
      };
    },
    getLog() {
      return log.slice();
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
