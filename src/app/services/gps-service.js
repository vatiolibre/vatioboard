const STORAGE_KEY = "vatioboard.gps_service.snapshot.v1";

function saveSnapshot(snapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort resume hint only.
  }
}

function readSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clonePosition(position) {
  if (!position?.coords) return position;

  return {
    timestamp: position.timestamp || Date.now(),
    coords: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      altitude: position.coords.altitude,
      altitudeAccuracy: position.coords.altitudeAccuracy,
      heading: position.coords.heading,
      speed: position.coords.speed,
    },
  };
}

export function createGpsService({ geolocation = navigator.geolocation } = {}) {
  const subscribers = new Map();
  const listeners = new Set();
  const nativeWatchPosition = geolocation?.watchPosition?.bind(geolocation);
  const nativeClearWatch = geolocation?.clearWatch?.bind(geolocation);
  let nextId = 1;
  let nativeWatchId = null;
  let snapshot = readSnapshot() || {
    status: geolocation ? "idle" : "unsupported",
    lastPosition: null,
    lastError: null,
    lastCallbackAtMs: 0,
  };

  function emit() {
    const detail = getSnapshot();
    for (const listener of listeners) {
      try {
        listener(detail);
      } catch {
        // Subscriber isolation.
      }
    }
  }

  function persistAndEmit(nextSnapshot) {
    snapshot = {
      ...snapshot,
      ...nextSnapshot,
    };
    saveSnapshot(snapshot);
    emit();
  }

  function handlePosition(position) {
    const cloned = clonePosition(position);
    persistAndEmit({
      status: "active",
      lastPosition: cloned,
      lastError: null,
      lastCallbackAtMs: Date.now(),
    });

    for (const subscriber of subscribers.values()) {
      try {
        subscriber.success(position);
      } catch {
        // Match native geolocation behavior: one callback should not break others.
      }
    }
  }

  function handleError(error) {
    persistAndEmit({
      status: "error",
      lastError: {
        code: error?.code ?? 0,
        message: error?.message || "Geolocation failed.",
      },
      lastCallbackAtMs: Date.now(),
    });

    for (const subscriber of subscribers.values()) {
      try {
        subscriber.error?.(error);
      } catch {
        // Subscriber isolation.
      }
    }
  }

  function ensureNativeWatch() {
    if (nativeWatchId !== null || !nativeWatchPosition) return;
    persistAndEmit({ status: "starting" });
    nativeWatchId = nativeWatchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    });
  }

  function stopNativeWatchIfIdle() {
    if (subscribers.size > 0 || nativeWatchId === null || !nativeClearWatch) return;
    nativeClearWatch(nativeWatchId);
    nativeWatchId = null;
    persistAndEmit({ status: "idle" });
  }

  function watchPosition(success, error, options = {}) {
    if (typeof success !== "function") {
      throw new TypeError("watchPosition success callback is required.");
    }

    if (!nativeWatchPosition) {
      const unsupportedError = {
        code: 2,
        message: "Geolocation is unavailable.",
      };
      if (typeof error === "function") {
        setTimeout(() => error(unsupportedError), 0);
      }
      return nextId++;
    }

    const id = nextId++;
    subscribers.set(id, {
      success,
      error,
      options,
    });
    ensureNativeWatch();
    return id;
  }

  function clearWatch(id) {
    subscribers.delete(id);
    stopNativeWatchIfIdle();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener(getSnapshot());
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot() {
    return {
      ...snapshot,
      subscriberCount: subscribers.size,
      nativeWatchActive: nativeWatchId !== null,
    };
  }

  function installGlobalShim() {
    if (!geolocation || geolocation.__vatioboardGpsServiceShim) return false;

    try {
      geolocation.watchPosition = watchPosition;
      geolocation.clearWatch = clearWatch;
      Object.defineProperty(geolocation, "__vatioboardGpsServiceShim", {
        value: true,
        configurable: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  return {
    watchPosition,
    clearWatch,
    subscribe,
    getSnapshot,
    installGlobalShim,
  };
}
