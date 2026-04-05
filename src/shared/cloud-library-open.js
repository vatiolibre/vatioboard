import { importRun, isAccelPayloadComplete } from "../accel/storage.js";
import {
  hasBoardDrawingContent,
  loadBoardDrawing,
  queuePendingBoardDocumentOpen,
} from "../board/storage.js";
import { t } from "../i18n.js";
import { importReplaySession, isReplayPayloadComplete } from "../replay/session.js";
import {
  CLOUD_LIBRARY_TAB_KEYS,
  cloudLibraryResources,
} from "./cloud-library-resources.js";

function encodeRecordName(value) {
  return encodeURIComponent(String(value || "").trim());
}

function confirmReplaceBoardDocument(message, confirmReplace) {
  if (typeof confirmReplace === "function") {
    return Boolean(confirmReplace(message));
  }

  if (typeof window?.confirm === "function") {
    return window.confirm(message);
  }

  return false;
}

function createCloudLibraryOpenError(statusKey, message) {
  const error = new Error(message);
  error.libraryStatusKey = statusKey;
  return error;
}

async function resolveFullDetail(tabKey, name) {
  const resourceConfig = cloudLibraryResources[tabKey];
  if (!resourceConfig) {
    throw new Error("Unsupported cloud library resource.");
  }

  return resourceConfig.resource.getDetail(name, {
    force: true,
    mode: "full",
  });
}

export async function openCloudReplaySession(name) {
  const detail = await resolveFullDetail(CLOUD_LIBRARY_TAB_KEYS.speed, name);
  if (detail?.record?.can_open === false || !isReplayPayloadComplete(detail?.payload)) {
    throw createCloudLibraryOpenError(
      "cloudLibraryTelemetryUnavailable",
      "Replay telemetry is unavailable."
    );
  }

  const importedSession = await importReplaySession(detail.payload, {
    saveLast: true,
  });
  if (!importedSession?.id) {
    throw new Error("Replay payload could not be imported.");
  }

  return `/replay.html?record=${encodeRecordName(importedSession.id)}`;
}

export async function openCloudAccelRun(name) {
  const detail = await resolveFullDetail(CLOUD_LIBRARY_TAB_KEYS.accel, name);
  if (detail?.record?.can_open === false || !isAccelPayloadComplete(detail?.payload)) {
    throw createCloudLibraryOpenError(
      "cloudLibraryTelemetryUnavailable",
      "Acceleration telemetry is unavailable."
    );
  }

  const importedRun = await importRun(detail.payload);
  if (!importedRun?.id) {
    throw new Error("Acceleration payload could not be imported.");
  }

  return `/accel.html?run=${encodeRecordName(importedRun.id)}`;
}

export async function openCloudBoardDocument(name, { confirmReplace } = {}) {
  const detail = await resolveFullDetail(CLOUD_LIBRARY_TAB_KEYS.boardDocuments, name);
  if (!detail?.document || detail?.payload === null || typeof detail?.payload !== "object") {
    throw new Error("Board document payload is unavailable.");
  }

  const localDrawing = await loadBoardDrawing().catch(() => null);
  if (hasBoardDrawingContent(localDrawing)) {
    const title = detail.document.title || t("boardDocumentUntitled");
    const shouldReplace = confirmReplaceBoardDocument(
      t("boardDocumentOpenReplaceConfirm", { title }),
      confirmReplace
    );
    if (!shouldReplace) {
      return null;
    }
  }

  queuePendingBoardDocumentOpen({
    document: detail.document,
    payload: detail.payload,
  });
  return "/";
}
