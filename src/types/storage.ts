export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface PersistedRecord {
  [key: string]: JsonValue | undefined;
  id?: string;
  createdAt?: number;
  updatedAt?: number;
  version?: number;
}

export type RepositoryResult<T = PersistedRecord> = {
  ok: boolean;
  value?: T;
  error?: unknown;
};

export type PersistedJson = JsonValue;
