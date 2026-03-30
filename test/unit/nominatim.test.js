import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetNominatimTestState,
  createNominatimClient,
  NominatimPolicyError,
} from "../../src/shared/nominatim.js";

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("shared Nominatim client", () => {
  beforeEach(() => {
    __resetNominatimTestState();
  });

  it("caches identical requests and reuses the cached payload", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ display_name: "Bogota" }]));
    const client = createNominatimClient({
      fetchImpl,
      scheduleStorage: createMemoryStorage(),
      cacheStorage: createMemoryStorage(),
      now: () => 0,
      wait: async () => {},
    });

    const first = await client.search({ q: "Bogota" });
    const second = await client.search({ q: "Bogota" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.meta.fromCache).toBe(false);
    expect(second.meta.fromCache).toBe(true);
    expect(second.data).toEqual([{ display_name: "Bogota" }]);
  });

  it("enforces the 1 request per second limit across client instances for the same base URL", async () => {
    const scheduleStorage = createMemoryStorage();
    const cacheStorage = createMemoryStorage();
    const wait = vi.fn(async (ms) => {
      nowValue += ms;
    });
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 0, message: "OK" }));
    let nowValue = 100;

    const firstClient = createNominatimClient({
      fetchImpl,
      scheduleStorage,
      cacheStorage,
      now: () => nowValue,
      wait,
    });

    await firstClient.status();

    __resetNominatimTestState();

    const secondClient = createNominatimClient({
      fetchImpl,
      scheduleStorage,
      cacheStorage,
      now: () => nowValue,
      wait,
    });

    await secondClient.status();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(1000);
  });

  it("blocks the details endpoint on the public server", async () => {
    const client = createNominatimClient({
      fetchImpl: vi.fn(),
      scheduleStorage: createMemoryStorage(),
      cacheStorage: createMemoryStorage(),
    });

    await expect(client.details({ place_id: "123" })).rejects.toBeInstanceOf(NominatimPolicyError);
  });
});
