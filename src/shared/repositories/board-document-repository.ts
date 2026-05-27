import {
  CLOUD_LIBRARY_TAB_KEYS,
  cloudLibraryResources,
} from '../cloud-library-resources.js';
import {
  consumeNavigationPayloadHandoff as consumeNavigationPayloadHandoffUntyped,
  NAVIGATION_PAYLOAD_RESOURCES,
  queueNavigationPayloadHandoff as queueNavigationPayloadHandoffUntyped,
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

export interface BoardDocumentMeta extends Record<string, unknown> {
  name?: string;
  title?: string;
  updated_at_ms?: number;
  updatedAtMs?: number;
}

export type BoardDrawingPayload = Record<string, unknown>;

export interface BoardDocumentOpenPayload {
  document: BoardDocumentMeta | null;
  payload: BoardDrawingPayload;
}

interface CloudLibraryBoardDetail {
  document?: BoardDocumentMeta | null;
  payload?: BoardDrawingPayload | null;
}

interface CloudLibraryBoardResource {
  getDetail(name: string, options: { force: boolean; mode: string }): Promise<CloudLibraryBoardDetail>;
}

interface NavigationPayloadHandoff<TPayload = unknown> {
  payload?: TPayload | null;
  meta?: Record<string, unknown> | null;
}

interface QueueNavigationPayloadOptions<TPayload = unknown> {
  resourceType: string;
  recordId?: string;
  payload?: TPayload | null;
  meta?: Record<string, unknown> | null;
}

const translate = t as (key: string, params?: Record<string, unknown>) => string;
const consumeNavigationPayloadHandoff = consumeNavigationPayloadHandoffUntyped as (
  options: { resourceType: string; recordId?: string },
) => NavigationPayloadHandoff<unknown> | null;
const queueNavigationPayloadHandoff = queueNavigationPayloadHandoffUntyped as <TPayload>(
  options: QueueNavigationPayloadOptions<TPayload>,
) => NavigationPayloadHandoff<TPayload> | null;
const boardResource = cloudLibraryResources[CLOUD_LIBRARY_TAB_KEYS.boardDocuments]?.resource as
  | CloudLibraryBoardResource
  | undefined;

async function confirmReplaceBoardDocument(message: string): Promise<boolean> {
  return showConfirmDialog({
    title: translate('createNewConfirmTitle'),
    message,
    confirmLabel: translate('discard'),
    destructive: true,
  });
}

async function loadCloudLibraryBoardDetail(name: string): Promise<CloudLibraryBoardDetail> {
  if (!boardResource) {
    throw new Error('Board document cloud library resource is unavailable.');
  }

  return boardResource.getDetail(name, {
    force: true,
    mode: 'full',
  });
}

export async function consumeBoardDocumentOpen(): Promise<BoardDocumentOpenPayload> {
  const handoff = consumeNavigationPayloadHandoff({
    resourceType: NAVIGATION_PAYLOAD_RESOURCES.boardDocument,
  });
  if (handoff?.payload && typeof handoff.payload === 'object') {
    const meta = handoff.meta as { document?: BoardDocumentMeta | null } | null | undefined;
    return {
      document: meta?.document ?? null,
      payload: handoff.payload as BoardDrawingPayload,
    };
  }

  const pendingOpen = consumePendingBoardDocumentOpen();
  if (pendingOpen?.payload && typeof pendingOpen.payload === 'object') {
    return pendingOpen as BoardDocumentOpenPayload;
  }

  return {
    document: null,
    payload: await loadBoardDrawing() as BoardDrawingPayload,
  };
}

export async function persistBoardDocumentSelection({
  document = null,
  payload = null,
}: {
  document?: BoardDocumentMeta | null;
  payload?: BoardDrawingPayload | null;
} = {}): Promise<void> {
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

export function loadBoardDocumentMeta(): BoardDocumentMeta | null {
  return loadCurrentBoardDocumentMeta();
}

export async function openBoardDocumentFromCloud(name: string): Promise<string | null> {
  const detail = await loadCloudLibraryBoardDetail(name);
  if (!detail?.document || detail?.payload === null || typeof detail?.payload !== 'object') {
    throw new Error('Board document payload is unavailable.');
  }

  const localDrawing = await loadBoardDrawing().catch(() => null);
  if (hasBoardDrawingContent(localDrawing)) {
    const title = detail.document.title || translate('boardDocumentUntitled');
    const shouldReplace = await confirmReplaceBoardDocument(
      translate('boardDocumentOpenReplaceConfirm', { title }),
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
