export const RECOVERY_METADATA_STORAGE_KEY = "vatioboard.recovery.v1";

export type RecoveryFlushReason = "mutation" | "visibility-hidden" | "pagehide" | "destroy";

export interface RecoveryAdapter {
  id: string;
  hydrate?(): void | Promise<void>;
  flush?(reason: RecoveryFlushReason): void | Promise<void>;
  reconcile?(nowMs: number): void | Promise<void>;
  destroy?(): void;
}

export interface RecoveryCoordinator {
  register(adapter: RecoveryAdapter): () => void;
  hydrate(): Promise<void>;
  flush(reason?: RecoveryFlushReason): Promise<void>;
  reconcile(nowMs?: number): Promise<void>;
  destroy(): Promise<void>;
}

function persistRecoveryMetadata(reason: RecoveryFlushReason) {
  try {
    localStorage.setItem(RECOVERY_METADATA_STORAGE_KEY, JSON.stringify({
      version: 1,
      updatedAtMs: Date.now(),
      reason,
    }));
  } catch {
    // Recovery metadata is advisory; feature-owned persistence remains authoritative.
  }
}

export function createRecoveryCoordinator(): RecoveryCoordinator {
  const adapters = new Map<string, RecoveryAdapter>();
  let hydrated = false;
  let destroyed = false;
  let flushChain = Promise.resolve();

  const safelyRun = async (adapter: RecoveryAdapter, operation: () => void | Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      console.warn(`[vatioboard:recovery] ${adapter.id} recovery operation failed.`, error);
    }
  };

  const register = (adapter: RecoveryAdapter) => {
    if (destroyed || !adapter?.id) return () => {};
    adapters.set(adapter.id, adapter);
    if (hydrated) void safelyRun(adapter, () => adapter.hydrate?.());
    return () => {
      if (adapters.get(adapter.id) !== adapter) return;
      adapters.delete(adapter.id);
      adapter.destroy?.();
    };
  };

  const hydrate = async () => {
    if (destroyed || hydrated) return;
    hydrated = true;
    await Promise.all(Array.from(adapters.values(), (adapter) => (
      safelyRun(adapter, () => adapter.hydrate?.())
    )));
  };

  const flush = (reason: RecoveryFlushReason = "mutation") => {
    if (destroyed && reason !== "destroy") return Promise.resolve();
    flushChain = flushChain.then(async () => {
      persistRecoveryMetadata(reason);
      await Promise.all(Array.from(adapters.values(), (adapter) => (
        safelyRun(adapter, () => adapter.flush?.(reason))
      )));
    });
    return flushChain;
  };

  const reconcile = async (nowMs = Date.now()) => {
    if (destroyed) return;
    await Promise.all(Array.from(adapters.values(), (adapter) => (
      safelyRun(adapter, () => adapter.reconcile?.(nowMs))
    )));
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") void flush("visibility-hidden");
    else void reconcile();
  };
  const onPageHide = () => void flush("pagehide");
  const onPageShow = () => void reconcile();

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);

  return {
    register,
    hydrate,
    flush,
    reconcile,
    async destroy() {
      if (destroyed) return;
      await flush("destroy");
      destroyed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      for (const adapter of adapters.values()) adapter.destroy?.();
      adapters.clear();
    },
  };
}
