import { t } from "../i18n.js";

const SINGLE_TAB_SCOPE = "app";
const SINGLE_TAB_LOCK_PREFIX = "vatioboard:single-tab";
const SINGLE_TAB_LEASE_PREFIX = "vatioboard.single_tab.lease";
const SINGLE_TAB_HINT_PREFIX = "vatioboard.single_tab.hint";
const SINGLE_TAB_DB_NAME = "vatioboard-single-tab";
const SINGLE_TAB_DB_STORE = "singleTabLocks";
const SINGLE_TAB_DB_VERSION = 1;
const SINGLE_TAB_LEASE_MS = 15000;
const SINGLE_TAB_HEARTBEAT_MS = 5000;
const BLOCKED_INTERACTION_EVENTS = [
  "click",
  "pointerdown",
  "pointerup",
  "pointermove",
  "keydown",
  "keyup",
  "keypress",
  "input",
  "change",
  "submit",
  "touchstart",
  "touchend",
  "wheel",
];
const ownerId = `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;

export const SINGLE_TAB_OWNERSHIP_EVENT = "vatioboard:single-tab-ownership";

let activeScope = SINGLE_TAB_SCOPE;
let blockerElement = null;
let blockerTitleElement = null;
let blockerMessageElement = null;
let blockerRetryButton = null;
let blockerCopyBound = false;
let blockedInteractionInstalled = false;
let cleanupInstalled = false;
let fallbackHeartbeatId = null;
let ownershipPromise = null;
let ownsSingleTab = false;
let webLockRelease = null;
let ownershipMode = "";
let indexedDbPromise = null;
let indexedDbRef = null;

function getLockName(scope = SINGLE_TAB_SCOPE) {
  return `${SINGLE_TAB_LOCK_PREFIX}:${String(scope || SINGLE_TAB_SCOPE).trim() || SINGLE_TAB_SCOPE}`;
}

function getLeaseKey(scope = SINGLE_TAB_SCOPE) {
  return `${SINGLE_TAB_LEASE_PREFIX}:${String(scope || SINGLE_TAB_SCOPE).trim() || SINGLE_TAB_SCOPE}`;
}

function getLeaseHintKey(scope = SINGLE_TAB_SCOPE) {
  return `${SINGLE_TAB_HINT_PREFIX}:${String(scope || SINGLE_TAB_SCOPE).trim() || SINGLE_TAB_SCOPE}`;
}

function hasActiveLease(lease) {
  return Boolean(
    lease
      && typeof lease.ownerId === "string"
      && lease.ownerId
      && Number.isFinite(lease.expiresAtMs)
      && lease.expiresAtMs > Date.now()
  );
}

function saveLeaseHint(scope = activeScope) {
  try {
    localStorage.setItem(
      getLeaseHintKey(scope),
      JSON.stringify({
        ownerId,
        updatedAtMs: Date.now(),
      })
    );
    return true;
  } catch {
    return false;
  }
}

function clearLeaseHint(scope = activeScope) {
  try {
    localStorage.removeItem(getLeaseHintKey(scope));
    return true;
  } catch {
    return false;
  }
}

function inspectLeaseHint(scope = SINGLE_TAB_SCOPE, expectedOwnerId = "") {
  try {
    const rawValue = localStorage.getItem(getLeaseHintKey(scope));
    if (rawValue === null) {
      return {
        available: true,
        present: false,
        ownerId: "",
      };
    }

    const hint = JSON.parse(rawValue);
    const ownerIdValue = typeof hint?.ownerId === "string" ? hint.ownerId : "";
    if (!ownerIdValue) {
      return {
        available: true,
        present: true,
        ownerId: "",
      };
    }

    return {
      available: true,
      present: true,
      ownerId: expectedOwnerId && ownerIdValue === expectedOwnerId ? ownerIdValue : ownerIdValue,
    };
  } catch {
    return {
      available: false,
      present: false,
      ownerId: "",
    };
  }
}

function emitOwnershipChange({ owned, reason = "" }) {
  if (
    typeof window === "undefined"
    || typeof window.dispatchEvent !== "function"
    || typeof CustomEvent !== "function"
  ) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(SINGLE_TAB_OWNERSHIP_EVENT, {
      detail: {
        owned: owned === true,
        ownerId,
        reason: String(reason || ""),
        scope: activeScope,
      },
    })
  );
}

function clearFallbackHeartbeat() {
  if (fallbackHeartbeatId !== null && typeof window !== "undefined") {
    window.clearInterval(fallbackHeartbeatId);
    fallbackHeartbeatId = null;
  }
}

function installBlockedInteractionHandlers() {
  if (blockedInteractionInstalled || typeof document === "undefined") return;
  blockedInteractionInstalled = true;

  const isBlockerTarget = (target) => {
    if (!blockerElement) return false;
    return blockerElement === target || blockerElement.contains(target);
  };

  for (const eventName of BLOCKED_INTERACTION_EVENTS) {
    document.addEventListener(
      eventName,
      (event) => {
        if (document.documentElement.dataset.singleTabBlocked !== "true") return;
        if (isBlockerTarget(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    );
  }

  document.addEventListener(
    "focusin",
    (event) => {
      if (document.documentElement.dataset.singleTabBlocked !== "true") return;
      if (isBlockerTarget(event.target)) return;
      blockerRetryButton?.focus();
    },
    true
  );
}

function setBlockedState(isBlocked) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.singleTabBlocked = isBlocked ? "true" : "false";
}

function updateBlockerCopy() {
  if (!blockerElement) return;
  blockerTitleElement.textContent = t("singleTabBlockedTitle");
  blockerMessageElement.textContent = t("singleTabBlockedMessage");
  blockerRetryButton.textContent = t("singleTabRetry");
}

function ensureBlocker() {
  if (typeof document === "undefined") return null;
  if (blockerElement) return blockerElement;

  const overlay = document.createElement("div");
  overlay.hidden = true;
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "2147483647";
  overlay.style.display = "grid";
  overlay.style.placeItems = "center";
  overlay.style.padding = "24px";
  overlay.style.background = "rgba(10, 12, 16, 0.82)";
  overlay.style.backdropFilter = "blur(8px)";

  const card = document.createElement("div");
  card.style.width = "min(100%, 420px)";
  card.style.padding = "24px";
  card.style.borderRadius = "20px";
  card.style.background = "#121820";
  card.style.color = "#f5f7fb";
  card.style.boxShadow = "0 28px 80px rgba(0, 0, 0, 0.45)";
  card.style.border = "1px solid rgba(255, 255, 255, 0.08)";
  card.style.fontFamily = "system-ui, sans-serif";

  const title = document.createElement("h1");
  title.style.margin = "0 0 12px";
  title.style.fontSize = "1.35rem";
  title.style.lineHeight = "1.2";

  const message = document.createElement("p");
  message.style.margin = "0 0 18px";
  message.style.fontSize = "0.98rem";
  message.style.lineHeight = "1.5";
  message.style.color = "rgba(245, 247, 251, 0.84)";

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.style.border = "0";
  retryButton.style.borderRadius = "999px";
  retryButton.style.padding = "12px 18px";
  retryButton.style.font = "inherit";
  retryButton.style.fontWeight = "600";
  retryButton.style.cursor = "pointer";
  retryButton.style.background = "#f5f7fb";
  retryButton.style.color = "#121820";
  retryButton.addEventListener("click", async () => {
    retryButton.disabled = true;
    try {
      const acquired = await ensureSingleTabOwnership({
        force: true,
        scope: activeScope,
      });
      if (acquired && typeof window !== "undefined") {
        window.location.reload();
      }
    } finally {
      retryButton.disabled = false;
    }
  });

  card.append(title, message, retryButton);
  overlay.append(card);

  blockerElement = overlay;
  blockerTitleElement = title;
  blockerMessageElement = message;
  blockerRetryButton = retryButton;
  updateBlockerCopy();

  const mount = document.body || document.documentElement;
  mount.append(overlay);

  if (!blockerCopyBound) {
    blockerCopyBound = true;
    document.addEventListener("i18n:change", updateBlockerCopy);
  }
  installBlockedInteractionHandlers();

  return blockerElement;
}

function showBlockedOverlay() {
  const overlay = ensureBlocker();
  if (!overlay) return;
  overlay.hidden = false;
  setBlockedState(true);
}

function hideBlockedOverlay() {
  if (blockerElement) {
    blockerElement.hidden = true;
  }
  setBlockedState(false);
}

function setOwnershipState(owned, { reason = "", blocked = false, mode = ownershipMode } = {}) {
  const nextOwned = owned === true;
  const changed = ownsSingleTab !== nextOwned || ownershipMode !== (nextOwned ? mode : "");

  ownsSingleTab = nextOwned;
  ownershipMode = nextOwned ? mode : "";
  if (nextOwned) {
    hideBlockedOverlay();
  } else if (blocked) {
    showBlockedOverlay();
  }

  if (changed || blocked) {
    emitOwnershipChange({
      owned: nextOwned,
      reason,
    });
  }
}

function installCleanupHandlers() {
  if (cleanupInstalled || typeof window === "undefined") return;
  cleanupInstalled = true;

  const cleanup = () => {
    releaseSingleTabOwnership();
  };

  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);
  window.addEventListener("pageshow", (event) => {
    if (event?.persisted !== true) return;
    setBlockedState(true);
    void ensureSingleTabOwnership({
      force: true,
      scope: activeScope,
    }).then((owned) => {
      if (!owned) {
        showBlockedOverlay();
      }
    });
  });
}

async function openIndexedDb() {
  if (typeof indexedDB === "undefined" || typeof indexedDB.open !== "function") {
    return null;
  }

  if (indexedDbRef) {
    return indexedDbRef;
  }

  if (!indexedDbPromise) {
    indexedDbPromise = new Promise((resolve) => {
      const clearCachedDatabase = (target = indexedDbRef) => {
        if (indexedDbRef === target) {
          indexedDbRef = null;
        }
      };

      const cacheDatabase = (database) => {
        if (!database) return null;
        if (indexedDbRef === database) return database;

        const clear = () => {
          clearCachedDatabase(database);
        };

        try {
          database.onclose = clear;
        } catch {
          // Ignore environments that do not expose onclose.
        }

        try {
          database.onversionchange = () => {
            clear();
            try {
              database.close();
            } catch {
              // Ignore close failures while cleaning up stale handles.
            }
          };
        } catch {
          // Ignore environments that do not expose onversionchange.
        }

        indexedDbRef = database;
        return database;
      };

      const finish = (database) => {
        indexedDbPromise = null;
        resolve(database);
      };

      try {
        const request = indexedDB.open(SINGLE_TAB_DB_NAME, SINGLE_TAB_DB_VERSION);

        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(SINGLE_TAB_DB_STORE)) {
            database.createObjectStore(SINGLE_TAB_DB_STORE);
          }
        };

        request.onsuccess = () => finish(cacheDatabase(request.result));
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
      } catch {
        finish(null);
      }
    });
  }

  return indexedDbPromise;
}

function clearCachedIndexedDb(target = indexedDbRef) {
  if (indexedDbRef === target) {
    indexedDbRef = null;
  }
}

async function executeIndexedDbLeaseTransaction(database, scope, handler) {
  return new Promise((resolve) => {
    let settled = false;
    let value = null;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const transaction = database.transaction(SINGLE_TAB_DB_STORE, "readwrite");
      const store = transaction.objectStore(SINGLE_TAB_DB_STORE);
      const key = getLeaseKey(scope);
      const request = store.get(key);

      request.onsuccess = () => {
        const currentLease =
          request.result && typeof request.result === "object"
            ? {
                ownerId: typeof request.result.ownerId === "string" ? request.result.ownerId : "",
                expiresAtMs: Number.isFinite(request.result.expiresAtMs)
                  ? request.result.expiresAtMs
                  : 0,
                hintReady: request.result.hintReady === true,
              }
            : null;
        value = handler({
          store,
          key,
          currentLease,
          nowMs: Date.now(),
        });
      };

      request.onerror = () => {
        clearCachedIndexedDb(database);
        settle({
          supported: true,
          errored: true,
          value: null,
        });
      };

      transaction.onabort = () => {
        clearCachedIndexedDb(database);
        settle({
          supported: true,
          errored: true,
          value: null,
        });
      };

      transaction.onerror = () => {
        clearCachedIndexedDb(database);
        settle({
          supported: true,
          errored: true,
          value: null,
        });
      };

      transaction.oncomplete = () => {
        settle({
          supported: true,
          errored: false,
          value,
        });
      };
    } catch {
      clearCachedIndexedDb(database);
      settle({
        supported: true,
        errored: true,
        value: null,
      });
    }
  });
}

async function runIndexedDbLeaseTransaction(scope, handler, { allowRetry = true } = {}) {
  const database = await openIndexedDb();
  if (!database) {
    return {
      supported: false,
      errored: false,
      value: null,
    };
  }

  const result = await executeIndexedDbLeaseTransaction(database, scope, handler);
  if (!result.errored || !allowRetry) {
    return result;
  }

  const retriedDatabase = await openIndexedDb();
  if (!retriedDatabase || retriedDatabase === database) {
    return result;
  }

  return executeIndexedDbLeaseTransaction(retriedDatabase, scope, handler);
}

async function releaseIndexedDbLease(scope = activeScope) {
  await runIndexedDbLeaseTransaction(scope, ({ currentLease, key, store }) => {
    if (currentLease?.ownerId === ownerId) {
      store.delete(key);
    }
    return null;
  });
}

async function renewIndexedDbLease(scope = activeScope) {
  const result = await runIndexedDbLeaseTransaction(scope, ({ currentLease, key, nowMs, store }) => {
    if (currentLease?.ownerId !== ownerId) {
      return false;
    }

    const hintReady = saveLeaseHint(scope);

    store.put(
      {
        ownerId,
        expiresAtMs: nowMs + SINGLE_TAB_LEASE_MS,
        hintReady,
      },
      key
    );
    return true;
  });

  return result.supported && result.errored !== true && result.value === true;
}

async function acquireIndexedDbLease(scope = activeScope) {
  const result = await runIndexedDbLeaseTransaction(scope, ({ currentLease, key, nowMs, store }) => {
    if (hasActiveLease(currentLease) && currentLease.ownerId !== ownerId) {
      if (currentLease.hintReady !== true) {
        return false;
      }

      const hintStatus = inspectLeaseHint(scope, currentLease.ownerId);
      if (!hintStatus.available) {
        return false;
      }
      if (hintStatus.present) {
        return false;
      }
    }

    const hintReady = saveLeaseHint(scope);

    store.put(
      {
        ownerId,
        expiresAtMs: nowMs + SINGLE_TAB_LEASE_MS,
        hintReady,
      },
      key
    );
    return true;
  });

  if (!result.supported) {
    return {
      supported: false,
      acquired: false,
      errored: false,
    };
  }

  return {
    supported: true,
    acquired: result.value === true,
    errored: result.errored === true,
  };
}

function startFallbackHeartbeat(scope = activeScope) {
  clearFallbackHeartbeat();
  if (typeof window === "undefined") return;

  fallbackHeartbeatId = window.setInterval(async () => {
    const stillOwned = ownershipMode === "indexeddb"
      ? await renewIndexedDbLease(scope)
      : false;

    if (!stillOwned) {
      releaseSingleTabOwnership({
        blocked: true,
        reason: "lost",
      });
    }
  }, SINGLE_TAB_HEARTBEAT_MS);
}

async function tryAcquireWebLock(scope = activeScope) {
  if (typeof navigator === "undefined" || typeof navigator.locks?.request !== "function") {
    return {
      supported: false,
      acquired: false,
      errored: false,
    };
  }

  return new Promise((resolve) => {
    let resolved = false;
    let releaseHold = () => {};
    const holdPromise = new Promise((release) => {
      releaseHold = release;
    });

    try {
      const requestPromise = navigator.locks.request(
        getLockName(scope),
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            if (!resolved) {
              resolved = true;
              resolve({
                supported: true,
                acquired: false,
                errored: false,
              });
            }
            return;
          }

          if (!resolved) {
            resolved = true;
            resolve({
              supported: true,
              acquired: true,
              errored: false,
              release: () => releaseHold(),
            });
          }

          await holdPromise;
        }
      );

      Promise.resolve(requestPromise).catch(() => {
        if (!resolved) {
          resolved = true;
          resolve({
            supported: true,
            acquired: false,
            errored: true,
          });
        }
      });
    } catch {
      resolve({
        supported: true,
        acquired: false,
        errored: true,
      });
    }
  });
}

async function attemptSingleTabOwnership(scope = activeScope) {
  installCleanupHandlers();

  const webLockResult = await tryAcquireWebLock(scope);
  if (webLockResult.acquired) {
    clearLeaseHint(scope);
    webLockRelease = webLockResult.release;
    setOwnershipState(true, {
      reason: "acquired",
      mode: "web-lock",
    });
    return true;
  }

  if (webLockResult.supported && !webLockResult.errored) {
    setOwnershipState(false, {
      reason: "blocked",
      blocked: true,
    });
    return false;
  }

  const indexedDbResult = await acquireIndexedDbLease(scope);
  if (indexedDbResult.acquired) {
    setOwnershipState(true, {
      reason: "acquired",
      mode: "indexeddb",
    });
    startFallbackHeartbeat(scope);
    return true;
  }
  if (indexedDbResult.supported && !indexedDbResult.errored) {
    setOwnershipState(false, {
      reason: "blocked",
      blocked: true,
    });
    return false;
  }

  setOwnershipState(false, {
    reason: "unsupported",
    blocked: true,
  });
  return false;
}

export async function ensureSingleTabOwnership({
  force = false,
  scope = SINGLE_TAB_SCOPE,
} = {}) {
  activeScope = String(scope || SINGLE_TAB_SCOPE).trim() || SINGLE_TAB_SCOPE;

  if (ownsSingleTab) return true;
  // Forced retries should share the current acquisition attempt instead of
  // racing it and potentially flipping the tab back to blocked.
  if (ownershipPromise) {
    return ownershipPromise;
  }

  ownershipPromise = attemptSingleTabOwnership(activeScope)
    .catch(() => {
      setOwnershipState(false, {
        reason: "error",
        blocked: true,
      });
      return false;
    })
    .finally(() => {
      if (!ownsSingleTab) {
        ownershipPromise = null;
      }
    });

  return ownershipPromise;
}

export function releaseSingleTabOwnership({
  blocked = false,
  reason = "released",
} = {}) {
  const releaseScope = activeScope;
  ownershipPromise = null;
  clearFallbackHeartbeat();

  if (typeof webLockRelease === "function") {
    try {
      webLockRelease();
    } catch {
      // Ignore lock release failures.
    }
  }
  webLockRelease = null;

  if (ownershipMode === "indexeddb") {
    clearLeaseHint(releaseScope);
    void releaseIndexedDbLease(releaseScope);
  }

  setOwnershipState(false, {
    reason,
    blocked,
  });
}

export function hasSingleTabOwnership() {
  return ownsSingleTab;
}
