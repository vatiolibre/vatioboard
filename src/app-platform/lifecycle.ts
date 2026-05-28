import type {
  VatioAppLifecycleRuntime,
  VatioAppLifecycleState,
} from "./types";

export function createAppLifecycle(initialState: VatioAppLifecycleState = "registered"): VatioAppLifecycleRuntime {
  let state = initialState;
  const listeners = new Set<(state: VatioAppLifecycleState) => void>();

  function setState(nextState: VatioAppLifecycleState) {
    state = nextState;
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
