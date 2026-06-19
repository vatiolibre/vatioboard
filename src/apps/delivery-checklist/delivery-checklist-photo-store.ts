import { createChunkedBlobStore } from "../../shared/chunked-blob-store.js";
import { createIndexedJsonKeyValueStore } from "../../shared/indexed-storage.js";
import { createStorageCapability, type StorageCapabilitySnapshot } from "../../shared/storage-capability.js";

export interface DeliveryChecklistPhotoRecord {
  blob?: Blob;
  id: string;
  sessionId: string;
  itemId: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  [key: string]: unknown;
}

const PHOTO_DB_NAME = "vatioboard_delivery_checklist_photos";
const PHOTO_STORE_NAME = "photos";

const baseStore = createIndexedJsonKeyValueStore({
  dbName: PHOTO_DB_NAME,
  storeName: PHOTO_STORE_NAME,
});

const photoStore = createChunkedBlobStore<DeliveryChecklistPhotoRecord>(baseStore as any);
const photoCapability = createStorageCapability({
  namespace: "delivery-checklist-photos",
  store: baseStore,
});

export function createDeliveryChecklistPhotoId(sessionId: string, itemId: string): string {
  return [
    String(sessionId || "session").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "session",
    String(itemId || "item").replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || "item",
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 8),
  ].join("-");
}

export async function detectDeliveryChecklistPhotoStorage(): Promise<StorageCapabilitySnapshot> {
  return photoCapability.detect();
}

export function getDeliveryChecklistPhotoStorageSnapshot(): StorageCapabilitySnapshot {
  return photoCapability.getSnapshot();
}

export async function saveDeliveryChecklistPhoto({
  id,
  sessionId,
  itemId,
  blob,
  name = "delivery-photo",
}: {
  id: string;
  sessionId: string;
  itemId: string;
  blob: Blob;
  name?: string;
}): Promise<DeliveryChecklistPhotoRecord | null> {
  const capability = await photoCapability.detect();
  if (!capability.indexedDbWritable || !(blob instanceof Blob)) return null;

  const record: DeliveryChecklistPhotoRecord = {
    id,
    sessionId,
    itemId,
    name,
    type: blob.type || "application/octet-stream",
    size: blob.size,
    createdAt: Date.now(),
    blob,
  };

  const saved = await photoStore.setValue(id, record);
  return saved ? record : null;
}

export async function getDeliveryChecklistPhoto(id: string): Promise<DeliveryChecklistPhotoRecord | null> {
  const photoId = String(id || "").trim();
  if (!photoId) return null;
  const record = await photoStore.getValue(photoId);
  return record || null;
}

export async function deleteDeliveryChecklistPhoto(id: string): Promise<boolean> {
  const photoId = String(id || "").trim();
  if (!photoId) return false;
  return photoStore.deleteValue(photoId);
}
