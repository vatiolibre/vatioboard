import {
  CLOUD_LIBRARY_TAB_KEYS,
  cloudLibraryResources,
} from '../cloud-library-resources.js';
import {
  consumeNavigationPayloadHandoff,
  NAVIGATION_PAYLOAD_RESOURCES,
  queueNavigationPayloadHandoff,
} from '../navigation-payload-handoff.js';
import {
  consumePendingBoardDocumentOpen,
  clearCurrentBoardDocumentMeta,
  hasBoardDrawingContent,
  loadBoardDrawing,
  loadCurrentBoardDocumentMeta,
  saveBoardDrawing,
  saveCurrentBoardDocumentMeta,
} from '../../board/storage.js';
import { t } from '../../i18n.js';
import { showConfirmDialog } from '../ui/confirm-dialog.js';

const boardResource = cloudLibraryResources[CLOUD_LIBRARY_TAB_KEYS.boardDocuments]?.resource;

async function confirmReplaceBoardDocument(message) {
  return showConfirmDialog({
    title: t('createNewConfirmTitle'),
    message,
    confirmLabel: t('discard'),
    destructive: true,
  });
}

async function loadCloudLibraryBoardDetail(name) {
  if (!boardResource) {
    throw new Error('Board document cloud library resource is unavailable.');
  }

  return boardResource.getDetail(name, {
    force: true,
    mode: 'full',
  });
}

export async function consumeBoardDocumentOpen() {
  const handoff = consumeNavigationPayloadHandoff({
    resourceType: NAVIGATION_PAYLOAD_RESOURCES.boardDocument,
  });
  if (handoff?.payload && typeof handoff.payload === 'object') {
    return {
      document: handoff.meta?.document ?? null,
      payload: handoff.payload,
    };
  }

  const pendingOpen = consumePendingBoardDocumentOpen();
  if (pendingOpen?.payload && typeof pendingOpen.payload === 'object') {
    return pendingOpen;
  }

  return {
    document: null,
    payload: await loadBoardDrawing(),
  };
}

export async function persistBoardDocumentSelection({ document = null, payload = null } = {}) {
  if (document?.name) {
    saveCurrentBoardDocumentMeta({
      name: document.name,
      title: document.title || '',
      updatedAtMs: document.updated_at_ms || payload?.updatedAtMs || Date.now(),
    });
  } else {
    clearCurrentBoardDocumentMeta();
  }

  if (payload && typeof payload === 'object') {
    await saveBoardDrawing(payload);
  }
}

export function loadBoardDocumentMeta() {
  return loadCurrentBoardDocumentMeta();
}

export async function openBoardDocumentFromCloud(name) {
  const detail = await loadCloudLibraryBoardDetail(name);
  if (!detail?.document || detail?.payload === null || typeof detail?.payload !== 'object') {
    throw new Error('Board document payload is unavailable.');
  }

  const localDrawing = await loadBoardDrawing().catch(() => null);
  if (hasBoardDrawingContent(localDrawing)) {
    const title = detail.document.title || t('boardDocumentUntitled');
    const shouldReplace = await confirmReplaceBoardDocument(
      t('boardDocumentOpenReplaceConfirm', { title }),
    );
    if (!shouldReplace) {
      return null;
    }
  }

  queueNavigationPayloadHandoff({
    resourceType: NAVIGATION_PAYLOAD_RESOURCES.boardDocument,
    recordId: detail.document.name || 'primary',
    payload: detail.payload,
    meta: {
      document: detail.document,
    },
  });
  return '/';
}