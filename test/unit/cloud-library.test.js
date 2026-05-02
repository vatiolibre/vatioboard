import { beforeEach, describe, expect, it, vi } from "vitest";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

describe("cloud library resource cache", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("keeps a shared list request alive when one caller aborts", async () => {
    const { createCloudLibraryResource } = await import("../../src/shared/cloud-library.js");
    const listDeferred = createDeferred();
    const resource = createCloudLibraryResource({
      resourceKey: "test-list",
      listLoader: vi.fn(() => listDeferred.promise),
      detailLoader: vi.fn(async () => null),
      shouldPersistDetail: () => false,
    });

    const controller = new AbortController();
    const abortedPromise = resource.list({ tab: "speed" }, { signal: controller.signal });
    const sharedPromise = resource.list({ tab: "speed" });

    controller.abort();

    await expect(abortedPromise).rejects.toMatchObject({ name: "AbortError" });

    listDeferred.resolve({
      records: [{ name: "record-1" }],
    });

    await expect(sharedPromise).resolves.toEqual({
      records: [{ name: "record-1" }],
    });
  });

  it("does not let an invalidated list cache overwrite fresher data", async () => {
    const { createCloudLibraryResource } = await import("../../src/shared/cloud-library.js");
    const staleList = createDeferred();
    const freshList = createDeferred();
    const listLoader = vi
      .fn()
      .mockImplementationOnce(() => staleList.promise)
      .mockImplementationOnce(() => freshList.promise);
    const resource = createCloudLibraryResource({
      resourceKey: "test-list-generation",
      listLoader,
      detailLoader: vi.fn(async () => null),
      shouldPersistDetail: () => false,
    });

    const stalePromise = resource.list({ tab: "speed" });
    resource.invalidateList({ tab: "speed" });
    const freshPromise = resource.list({ tab: "speed" }, { force: true });

    staleList.resolve({ records: [{ name: "stale-record" }] });
    freshList.resolve({ records: [{ name: "fresh-record" }] });

    await stalePromise;
    await freshPromise;

    await expect(resource.list({ tab: "speed" })).resolves.toEqual({
      records: [{ name: "fresh-record" }],
    });
    expect(listLoader).toHaveBeenCalledTimes(2);
  });

  it("does not let an invalidated detail cache overwrite fresher data", async () => {
    const { createCloudLibraryResource } = await import("../../src/shared/cloud-library.js");
    const staleDetail = createDeferred();
    const freshDetail = createDeferred();
    const detailLoader = vi
      .fn()
      .mockImplementationOnce(() => staleDetail.promise)
      .mockImplementationOnce(() => freshDetail.promise);
    const resource = createCloudLibraryResource({
      resourceKey: "test-detail-generation",
      listLoader: vi.fn(async () => ({ records: [] })),
      detailLoader,
      shouldPersistDetail: () => false,
    });

    const stalePromise = resource.getDetail("record-1", { mode: "summary" });
    resource.invalidateDetail("record-1", { mode: "summary" });
    const freshPromise = resource.getDetail("record-1", {
      force: true,
      mode: "summary",
    });

    staleDetail.resolve({ record: { name: "record-1", title: "Stale title" } });
    freshDetail.resolve({ record: { name: "record-1", title: "Fresh title" } });

    await stalePromise;
    await freshPromise;

    await expect(resource.getDetail("record-1", { mode: "summary" })).resolves.toEqual({
      record: { name: "record-1", title: "Fresh title" },
    });
    expect(detailLoader).toHaveBeenCalledTimes(2);
  });

  it("treats non-ok list and detail responses as errors without caching them", async () => {
    const { createCloudLibraryResource } = await import("../../src/shared/cloud-library.js");
    const listLoader = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        records: [],
      })
      .mockResolvedValueOnce({
        ok: true,
        records: [{ name: "record-1" }],
      });
    const detailLoader = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        record: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        record: { name: "record-1", title: "Recovered title" },
      });
    const resource = createCloudLibraryResource({
      resourceKey: "test-errors",
      listLoader,
      detailLoader,
      shouldPersistDetail: () => false,
    });

    await expect(resource.list({ tab: "speed" })).rejects.toMatchObject({
      name: "CloudLibraryRequestError",
      status: 403,
    });
    await expect(resource.list({ tab: "speed" })).resolves.toEqual({
      ok: true,
      records: [{ name: "record-1" }],
    });

    await expect(resource.getDetail("record-1", { mode: "summary" })).rejects.toMatchObject({
      name: "CloudLibraryRequestError",
      status: 500,
    });
    await expect(resource.getDetail("record-1", { mode: "summary" })).resolves.toEqual({
      ok: true,
      record: { name: "record-1", title: "Recovered title" },
    });

    expect(listLoader).toHaveBeenCalledTimes(2);
    expect(detailLoader).toHaveBeenCalledTimes(2);
  });
});
