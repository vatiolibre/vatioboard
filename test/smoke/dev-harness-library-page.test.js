import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor() {
      this.handlers = {};
      this.sources = new Map();
      this.scrollZoom = { disable: vi.fn() };
      this.boxZoom = { disable: vi.fn() };
      this.doubleClickZoom = { disable: vi.fn() };
      this.dragPan = { disable: vi.fn() };
      this.dragRotate = { disable: vi.fn() };
      this.keyboard = { disable: vi.fn() };
      this.touchZoomRotate = { disable: vi.fn() };
      this.jumpTo = vi.fn();
      this.easeTo = vi.fn();
      this.fitBounds = vi.fn();
      this.remove = vi.fn();
      // Fire load synchronously on next microtask
      Promise.resolve().then(() => {
        for (const handler of this.handlers.load ?? []) handler();
      });
    }
    on(event, handler) { (this.handlers[event] ??= []).push(handler); return this; }
    addControl() { return this; }
    getSource(id) {
      if (!this.sources.has(id)) this.sources.set(id, { setData: vi.fn() });
      return this.sources.get(id);
    }
    setPaintProperty() {}
  }
  return { default: { Map: FakeMap, AttributionControl: class {} } };
});

async function settleLibraryTasks(iterations = 16) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createAuthenticatedLibraryFetch(handler) {
  return vi.fn(async (input, options) => {
    const url = typeof input === "string" ? input : String(input?.url ?? "");

    if (url.includes("/api/method/vatiolibre.vatiolibre.sso.status")) {
      return jsonResponse({
        message: {
          connected: false,
          is_guest: false,
        },
      });
    }

    if (url.includes("/api/method/frappe.auth.get_logged_user")) {
      return jsonResponse({ message: "library-user@vatiolibre.com" });
    }

    if (url.includes("/api/method/vatiolibre.vatiolibre.feature_access.get_my_feature_access")) {
      return jsonResponse({
        message: {
          has_active_subscription: true,
          csrf_token: "csrf-test-token",
          features: {
            cloud_sync: {
              enabled: true,
            },
            media_assets: {
              enabled: true,
            },
          },
        },
      });
    }

    return handler(url, options);
  });
}

describe("library.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");

      if (url.includes("/api/method/vatiolibre.vatiolibre.sso.status")) {
        return new Response(JSON.stringify({
          message: {
            connected: false,
            is_guest: false,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/method/frappe.auth.get_logged_user")) {
        return new Response(JSON.stringify({ message: "library-user@vatiolibre.com" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.feature_access.get_my_feature_access")) {
        return new Response(JSON.stringify({
          message: {
            has_active_subscription: true,
            csrf_token: "csrf-test-token",
            features: {
              cloud_sync: {
                enabled: true,
              },
              media_assets: {
                enabled: true,
              },
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings")) {
        return new Response(JSON.stringify({
          message: {
            records: [
              {
                name: "SYNC-REPLAY-1",
                title: "Downtown loop",
                record_title: "Downtown loop",
                started_at_label: "2026-04-01 10:00:00",
                sample_count: 24,
                duration_ms: 185000,
                distance_unit: "m",
                total_distance: 1280,
                total_distance_m: 1280,
                unit: "kmh",
                max_speed: 82,
                start_place_label: "Fort Lee",
                end_place_label: "West New York",
                has_samples_payload: true,
                payload_complete: true,
                can_open: true,
              },
              {
                name: "SYNC-REPLAY-2",
                title: "Bridge run",
                record_title: "Bridge run",
                started_at_label: "2026-04-02 10:00:00",
                sample_count: 12,
                duration_ms: 92000,
                distance_unit: "m",
                total_distance: 640,
                total_distance_m: 640,
                unit: "kmh",
                max_speed: 64,
                start_place_label: "Fort Lee",
                end_place_label: "Edgewater",
                has_samples_payload: false,
                payload_complete: false,
                can_open: false,
              },
            ],
            total_count: 2,
            has_more: false,
            next_offset: 2,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.get_my_speed_recording_detail")) {
        const recordName = new URL(url).searchParams.get("name");
        return new Response(JSON.stringify({
          message: {
            record: {
              name: recordName,
              title: recordName === "SYNC-REPLAY-2" ? "Bridge run" : "Downtown loop",
              started_at_label: "2026-04-02 10:00:00",
              sample_count: recordName === "SYNC-REPLAY-2" ? 12 : 24,
              duration_ms: recordName === "SYNC-REPLAY-2" ? 92000 : 185000,
              distance_unit: "m",
              total_distance: recordName === "SYNC-REPLAY-2" ? 640 : 1280,
              total_distance_m: recordName === "SYNC-REPLAY-2" ? 640 : 1280,
              unit: "kmh",
              max_speed: recordName === "SYNC-REPLAY-2" ? 64 : 82,
              start_place_label: "Fort Lee",
              end_place_label: recordName === "SYNC-REPLAY-2" ? "Edgewater" : "West New York",
              has_samples_payload: recordName !== "SYNC-REPLAY-2",
              payload_complete: recordName !== "SYNC-REPLAY-2",
              can_open: recordName !== "SYNC-REPLAY-2",
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.board_documents.list_my_board_documents")) {
        return new Response(JSON.stringify({
          message: {
            documents: [
              {
                name: "BOARD-DOC-1",
                title: "Skidpad sketch",
                command_count: 8,
                redo_command_count: 0,
                payload_size: 2048,
                updated_at_label: "2026-04-03 08:00:00",
                preview_image_url: "https://example.com/previews/board-1.png",
              },
            ],
            total_count: 1,
            has_more: false,
            next_offset: 1,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.board_documents.get_my_board_document_detail")) {
        return new Response(JSON.stringify({
          message: {
            document: {
              name: "BOARD-DOC-1",
              title: "Skidpad sketch",
              command_count: 8,
              redo_command_count: 0,
              payload_size: 2048,
              updated_at_label: "2026-04-03 08:00:00",
              preview_image_url: "https://example.com/previews/board-1.png",
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.media_assets.list_my_media_assets")) {
        return new Response(JSON.stringify({
          message: {
            assets: [
              {
                name: "MEDIA-1",
                title: "Skidpad export",
                created_at_label: "2026-04-03 08:30:00",
                modified_at_label: "2026-04-03 09:15:00",
                media_kind: "image",
                blob_size: 245760,
                original_filename: "skidpad.png",
                folder_path: "Exports",
                preview_image_url: "https://www.vatiolibre.com/files/skidpad.png?token=view#preview",
                download_url: "https://www.vatiolibre.com/private/files/skidpad.png?download=1",
                export_url: "https://www.vatiolibre.com/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1&as_attachment=1",
              },
            ],
            total_count: 1,
            has_more: false,
            next_offset: 1,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.media_assets.get_my_media_asset_detail")) {
        return new Response(JSON.stringify({
          message: {
            asset: {
              name: "MEDIA-1",
              title: "Skidpad export",
              created_at_label: "2026-04-03 08:30:00",
              modified_at_label: "2026-04-03 09:15:00",
              media_kind: "image",
              blob_size: 245760,
              original_filename: "skidpad.png",
              folder_path: "Exports",
              preview_image_url: "https://www.vatiolibre.com/files/skidpad.png?token=view#preview",
              download_url: "https://www.vatiolibre.com/private/files/skidpad.png?download=1",
              export_url: "https://www.vatiolibre.com/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1&as_attachment=1",
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.media_assets.get_my_media_asset_access")) {
        return new Response(JSON.stringify({
          message: {
            asset: { name: "MEDIA-1", content_hash: "abc123", media_kind: "image" },
            access: {
              download_url: "https://s3.example.com/media/skidpad.png?X-Amz-Signature=signed",
              image_url: "https://s3.example.com/media/skidpad.png?X-Amz-Signature=view",
              expires_in_seconds: 300,
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await bootHtmlPage("library.html");
  });

  it("loads cloud library summaries using list row as detail for speed recordings", async () => {
    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    expectPageSeo({
      titleIncludes: "VatioBoard Cloud Library",
      canonical: "https://vatioboard.com/library.html",
    });

    expect(document.querySelector('[data-tab="speed"]')?.dataset.active).toBe("true");
    expect(document.querySelectorAll(".library-record")).toHaveLength(2);
    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Downtown loop");

    document.querySelectorAll(".library-record")[1]?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks();

    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Bridge run");
    // With detailFromList, speed records use the list row as their detail
    // and no separate detail fetch is made.
    const detailCalls = window.fetch.mock.calls.filter(
      ([url]) => typeof url === "string" && url.includes("get_my_speed_recording_detail")
    );
    expect(detailCalls).toHaveLength(0);
  });

  it("disables open when a replay only has summary metadata", async () => {
    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelectorAll(".library-record")[1]?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks();

    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Bridge run");
    expect(document.getElementById("libraryActionOpen")?.disabled).toBe(true);
  });

  it("renders speed and distance meta with human-readable formatting", async () => {
    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    // First record: 1280m metric, 82 km/h
    const metaText = document.getElementById("libraryDetailMeta")?.textContent || "";
    expect(metaText).toContain("1.3 km");
    expect(metaText).toContain("82 km/h");
    expect(metaText).not.toContain("kmh");
    expect(metaText).not.toMatch(/1280\s*m\b/);

    // Switch to second record: 640m metric, 64 km/h
    document.querySelectorAll(".library-record")[1]?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks();

    const metaText2 = document.getElementById("libraryDetailMeta")?.textContent || "";
    expect(metaText2).toContain("640 m");
    expect(metaText2).toContain("64 km/h");
    expect(metaText2).not.toContain("kmh");
  });

  it("uses the shared launcher chrome and keeps auth controls inside the menu", async () => {
    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();
    const pageHeader = document.querySelector("header");

    expect(document.querySelector(".header-inner.library-header-inner")).toBeTruthy();
    expect(document.querySelector(".brand .brand-home")).toBeTruthy();
    expect(document.getElementById("libraryToolsMenuBtn")).toBeNull();
    expect(document.getElementById("libraryToolsMenuList")).toBeNull();
    expect(document.getElementById("libraryRefresh")?.querySelector("svg")).toBeTruthy();
    expect(document.querySelector(".library-account-panel")).toBeNull();
    expect(document.querySelector(".library-hero")).toBeNull();
    expect(document.querySelector(".library-overview")).toBeNull();

    // Route chip is a sibling of the toolbar, not inside it
    const headerInner = document.querySelector(".header-inner.library-header-inner");
    const routeChip = headerInner?.querySelector(":scope > .route-chip.library-page-chip");
    expect(routeChip).toBeTruthy();
    expect(routeChip?.textContent).toBe("LIBRARY");
    expect(document.querySelector(".library-toolbar .library-page-chip")).toBeNull();

    // Toolbar has library-specific aria
    const toolbar = document.querySelector(".toolbar.library-toolbar");
    expect(toolbar?.getAttribute("role")).toBe("toolbar");
    expect(toolbar?.getAttribute("aria-label")).toBe("Library controls");

    // Replay-style header composition: toolbar-right holds controls, sync indicator mounts to toolbar end
    const toolbarRight = document.querySelector(".library-toolbar-right");
    expect(toolbarRight?.querySelector(".library-toolbar-strip")).toBeTruthy();
    expect(document.getElementById("librarySyncSlot")).toBeNull();
    expect(toolbar?.querySelector(":scope > .cloud-sync-indicator.cloud-sync-indicator-end")).toBeTruthy();

    expect(pageHeader?.classList.contains("tools-menu-layer-open")).toBe(false);
    expect(document.getElementById("openLibraryReplayMenu")).toBeNull();
    expect(document.getElementById("openLibraryGpsLabMenu")).toBeNull();
    expect(document.getElementById("openLibraryCurrentMenu")).toBeNull();
  });

  it("switches to board documents and renders their summary-first detail", async () => {
    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="board_documents"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks();

    expect(document.querySelector('[data-tab="board_documents"]')?.dataset.active).toBe("true");
    expect(document.querySelectorAll(".library-record")).toHaveLength(1);
    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Skidpad sketch");

    // Board document with preview_image_url should render an image preview
    const previewImg = document.querySelector("#libraryDetailPreview img");
    expect(previewImg).toBeTruthy();
    expect(previewImg?.src).toContain("board-1.png");
    expect(document.getElementById("libraryDetailPreview")?.dataset.previewKind).toBe("image");
  });

  it("loads media asset previews through presigned URLs and downloads via signed storage URLs", async () => {
    const clickedHrefs = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function mockAnchorClick() {
        clickedHrefs.push(this.href);
      });

    try {
      const libraryPage = await import("../../src/library/dev-harness.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      await settleLibraryTasks();

      const previewImage = document.querySelector("#libraryDetailPreview img");
      // Preview resolves a presigned S3 URL via the access endpoint
      // (not the BFF redirect, which would 403 cross-origin).
      expect(previewImage?.getAttribute("src")).toContain(
        "s3.example.com"
      );
      expect(previewImage?.getAttribute("src")).toContain("X-Amz-Signature");

      document.getElementById("libraryActionDownload")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      await settleLibraryTasks();

      // Download resolves a signed S3 URL via the access endpoint.
      expect(clickedHrefs).toEqual([
        "https://s3.example.com/media/skidpad.png?X-Amz-Signature=signed",
      ]);
      // Download goes directly to object storage, not through BFF
      expect(clickedHrefs[0]).not.toContain("vatiolibre.com");
    } finally {
      clickSpy.mockRestore();
    }
  });

  it("keeps appended items across load-more pagination", async () => {
    const loadMore = createDeferred();
    let speedListCalls = 0;

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings")) {
        speedListCalls += 1;
        const requestUrl = new URL(url);
        const offset = Number(requestUrl.searchParams.get("offset") || "0");

        if (offset === 0 && speedListCalls === 1) {
          return jsonResponse({
            message: {
              records: [
                {
                  name: "SYNC-REPLAY-1",
                  title: "Downtown loop",
                  record_title: "Downtown loop",
                  started_at_label: "2026-04-01 10:00:00",
                },
                {
                  name: "SYNC-REPLAY-2",
                  title: "Bridge run",
                  record_title: "Bridge run",
                  started_at_label: "2026-04-02 10:00:00",
                },
              ],
              total_count: 4,
              has_more: true,
              next_offset: 2,
            },
          });
        }

        if (offset === 2) {
          return loadMore.promise;
        }

        return jsonResponse({
          message: { records: [], total_count: 0, has_more: false, next_offset: 0 },
        });
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    // Fresh speed response: no background revalidation, only the initial list call
    expect(speedListCalls).toBe(1);
    expect(Array.from(document.querySelectorAll(".library-record-title")).map((item) => item.textContent)).toEqual([
      "Downtown loop",
      "Bridge run",
    ]);

    document.getElementById("libraryLoadMore")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks(2);

    loadMore.resolve(jsonResponse({
      message: {
        records: [
          {
            name: "SYNC-REPLAY-3",
            title: "Tunnel sprint",
            record_title: "Tunnel sprint",
            started_at_label: "2026-04-03 10:00:00",
          },
          {
            name: "SYNC-REPLAY-4",
            title: "Harbor run",
            record_title: "Harbor run",
            started_at_label: "2026-04-04 10:00:00",
          },
        ],
        total_count: 4,
        has_more: false,
        next_offset: 4,
      },
    }));
    await settleLibraryTasks();

    expect(Array.from(document.querySelectorAll(".library-record-title")).map((item) => item.textContent)).toEqual([
      "Downtown loop",
      "Bridge run",
      "Tunnel sprint",
      "Harbor run",
    ]);
    expect(document.getElementById("libraryLoadMore")?.hidden).toBe(true);
  });

  it("surfaces a 401 list response as a login prompt instead of an empty success", async () => {
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings")) {
        return jsonResponse({ message: "Guest" }, 401);
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    expect(document.getElementById("libraryStatus")?.textContent).toBe(
      "Sign in with your VatioLibre account to browse your cloud library on this device."
    );
    expect(document.getElementById("libraryListEmpty")?.textContent).toBe(
      "Sign in with your VatioLibre account to browse your cloud library on this device."
    );
    expect(document.querySelectorAll(".library-record")).toHaveLength(0);
  });

  it("surfaces a 403 list response as access denied instead of an empty success", async () => {
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings")) {
        return jsonResponse({ message: "Forbidden" }, 403);
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    expect(document.getElementById("libraryStatus")?.textContent).toBe(
      "You do not have access to this cloud library section right now."
    );
    expect(document.getElementById("libraryListEmpty")?.textContent).toBe(
      "You do not have access to this cloud library section right now."
    );
    expect(document.querySelectorAll(".library-record")).toHaveLength(0);
  });

  it("uses list row as detail for speed records without a separate detail fetch", async () => {
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings")) {
        return jsonResponse({
          message: {
            records: [
              {
                name: "SYNC-REPLAY-1",
                title: "Downtown loop",
                record_title: "Downtown loop",
                started_at_label: "2026-04-01 10:00:00",
              },
            ],
            total_count: 1,
            has_more: false,
            next_offset: 1,
          },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.get_my_speed_recording_detail")) {
        return jsonResponse({ message: "Server error" }, 500);
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    // With detailFromList, no detail fetch is made — the list row IS the detail.
    // The 500 detail response is never triggered.
    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Downtown loop");
    expect(document.querySelectorAll(".library-record")).toHaveLength(1);
    // No detail fetch calls for speed records
    const detailCalls = window.fetch.mock.calls.filter(
      ([url]) => typeof url === "string" && url.includes("get_my_speed_recording_detail")
    );
    expect(detailCalls).toHaveLength(0);
  });

  it("removes a stale speed record when open hits a 404 on the payload detail", async () => {
    let speedListCalls = 0;
    const staleRecord = {
      name: "SYNC-REPLAY-GONE",
      title: "Gone run",
      record_title: "Gone run",
      started_at_label: "2026-04-05 08:00:00",
      sample_count: 18,
      duration_ms: 81000,
      has_samples_payload: true,
      payload_complete: true,
      can_open: true,
    };
    const remainingRecord = {
      name: "SYNC-REPLAY-OK",
      title: "Still here",
      record_title: "Still here",
      started_at_label: "2026-04-05 09:00:00",
      sample_count: 24,
      duration_ms: 120000,
      has_samples_payload: true,
      payload_complete: true,
      can_open: true,
    };

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings")) {
        speedListCalls += 1;
        const records = speedListCalls >= 2 ? [remainingRecord] : [staleRecord, remainingRecord];
        return jsonResponse({
          message: {
            records,
            total_count: records.length,
            has_more: false,
            next_offset: records.length,
          },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.get_my_speed_recording_detail")) {
        const recordName = new URL(url).searchParams.get("name");
        if (recordName === staleRecord.name) {
          return jsonResponse({ message: "Missing" }, 404);
        }

        return jsonResponse({
          message: {
            record: remainingRecord,
          },
        });
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    // With detailFromList, stale record is visible from the list.
    // Clicking "open" triggers a payload fetch that returns 404.
    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Gone run");
    document.getElementById("libraryActionOpen")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks();

    expect(Array.from(document.querySelectorAll(".library-record-title")).map((item) => item.textContent)).toEqual([
      "Still here",
    ]);
    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Still here");
    expect(document.querySelector(".library-record[data-selected='true'] .library-record-title")?.textContent).toBe("Still here");
  });

  it("removes a stale speed record when open hits a 404 on the full cloud detail", async () => {
    let speedListCalls = 0;
    const staleRecord = {
      name: "SYNC-REPLAY-GONE",
      title: "Gone run",
      record_title: "Gone run",
      started_at_label: "2026-04-05 08:00:00",
      sample_count: 18,
      duration_ms: 81000,
      has_samples_payload: true,
      payload_complete: true,
      can_open: true,
    };
    const remainingRecord = {
      name: "SYNC-REPLAY-OK",
      title: "Still here",
      record_title: "Still here",
      started_at_label: "2026-04-05 09:00:00",
      sample_count: 24,
      duration_ms: 120000,
      has_samples_payload: true,
      payload_complete: true,
      can_open: true,
    };

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings")) {
        speedListCalls += 1;
        const records = speedListCalls >= 2 ? [remainingRecord] : [staleRecord, remainingRecord];
        return jsonResponse({
          message: {
            records,
            total_count: records.length,
            has_more: false,
            next_offset: records.length,
          },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.get_my_speed_recording_detail")) {
        const requestUrl = new URL(url);
        const recordName = requestUrl.searchParams.get("name");

        if (recordName === staleRecord.name) {
          return jsonResponse({ message: "Missing" }, 404);
        }

        return jsonResponse({
          message: {
            record: recordName === staleRecord.name ? staleRecord : remainingRecord,
          },
        });
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.getElementById("libraryActionOpen")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks();

    expect(Array.from(document.querySelectorAll(".library-record-title")).map((item) => item.textContent)).toEqual([
      "Still here",
    ]);
    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Still here");
    expect(document.querySelector(".library-record[data-selected='true'] .library-record-title")?.textContent).toBe("Still here");
  });

  it("removes a stale speed record when delete returns 404", async () => {
    let speedListCalls = 0;
    const staleRecord = {
      name: "SYNC-REPLAY-GONE",
      title: "Gone run",
      record_title: "Gone run",
      started_at_label: "2026-04-05 08:00:00",
      sample_count: 18,
      duration_ms: 81000,
      has_samples_payload: true,
      payload_complete: true,
      can_open: true,
      entity_type: "replay_session",
      client_record_id: "replay-gone",
      device_id: "DEVICE-1",
    };
    const remainingRecord = {
      name: "SYNC-REPLAY-OK",
      title: "Still here",
      record_title: "Still here",
      started_at_label: "2026-04-05 09:00:00",
      sample_count: 24,
      duration_ms: 120000,
      has_samples_payload: true,
      payload_complete: true,
      can_open: true,
      entity_type: "replay_session",
      client_record_id: "replay-ok",
      device_id: "DEVICE-1",
    };

    window.fetch = createAuthenticatedLibraryFetch((url, options = {}) => {
      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings")) {
        speedListCalls += 1;
        const records = speedListCalls >= 2 ? [remainingRecord] : [staleRecord, remainingRecord];
        return jsonResponse({
          message: {
            records,
            total_count: records.length,
            has_more: false,
            next_offset: records.length,
          },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.get_my_speed_recording_detail")) {
        const recordName = new URL(url).searchParams.get("name");
        return jsonResponse({
          message: {
            record: recordName === staleRecord.name ? staleRecord : remainingRecord,
          },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.delete_my_sync_record")) {
        const body = new URLSearchParams(String(options?.body || ""));
        if (body.get("client_record_id") === staleRecord.client_record_id) {
          return jsonResponse({ message: "Missing" }, 404);
        }
        return jsonResponse({ message: { ok: true } });
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.getElementById("libraryActionDelete")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks(2);

    document.querySelector(".vb-confirm-btn--confirm")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks();

    expect(Array.from(document.querySelectorAll(".library-record-title")).map((item) => item.textContent)).toEqual([
      "Still here",
    ]);
    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Still here");
    expect(document.querySelector(".library-record[data-selected='true'] .library-record-title")?.textContent).toBe("Still here");
  });

  it("renders a map preview when a speed record includes preview_route", async () => {
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings")) {
        return jsonResponse({
          message: {
            records: [
              {
                name: "SYNC-REPLAY-MAP",
                title: "Riverside drive",
                record_title: "Riverside drive",
                started_at_label: "2026-04-05 14:00:00",
                sample_count: 80,
                duration_ms: 300000,
                has_samples_payload: true,
                payload_complete: true,
                can_open: true,
                preview_route: [
                  [-73.96, 40.81],
                  [-73.97, 40.82],
                  [-73.98, 40.83],
                ],
              },
            ],
            total_count: 1,
            has_more: false,
            next_offset: 1,
          },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.get_my_speed_recording_detail")) {
        return jsonResponse({
          message: {
            record: {
              name: "SYNC-REPLAY-MAP",
              title: "Riverside drive",
              started_at_label: "2026-04-05 14:00:00",
              sample_count: 80,
              duration_ms: 300000,
              has_samples_payload: true,
              payload_complete: true,
              can_open: true,
              preview_route: [
                [-73.96, 40.81],
                [-73.97, 40.82],
                [-73.98, 40.83],
              ],
            },
          },
        });
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    const preview = document.getElementById("libraryDetailPreview");
    expect(preview?.dataset.previewKind).toBe("map");
    expect(preview?.querySelector(".library-map-container")).toBeTruthy();
  });

  it("renders a map preview via fallback when preview_route is absent but places have coordinates", async () => {
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings")) {
        return jsonResponse({
          message: {
            records: [
              {
                name: "SYNC-REPLAY-FALLBACK",
                title: "Fort Lee",
                record_title: "Fort Lee",
                started_at_label: "2026-04-08 09:00:00",
                sample_count: 50,
                duration_ms: 180000,
                has_samples_payload: true,
                payload_complete: true,
                can_open: true,
                start_place: {
                  label: "Fort Lee",
                  detail: "New Jersey, US",
                  latitude: 40.8509,
                  longitude: -73.9701,
                },
                end_place: {
                  label: "Edgewater",
                  detail: "New Jersey, US",
                  latitude: 40.8271,
                  longitude: -73.9754,
                },
              },
            ],
            total_count: 1,
            has_more: false,
            next_offset: 1,
          },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.get_my_speed_recording_detail")) {
        return jsonResponse({
          message: {
            record: {
              name: "SYNC-REPLAY-FALLBACK",
              title: "Fort Lee",
              started_at_label: "2026-04-08 09:00:00",
              sample_count: 50,
              duration_ms: 180000,
              has_samples_payload: true,
              payload_complete: true,
              can_open: true,
              start_place: {
                label: "Fort Lee",
                detail: "New Jersey, US",
                latitude: 40.8509,
                longitude: -73.9701,
              },
              end_place: {
                label: "Edgewater",
                detail: "New Jersey, US",
                latitude: 40.8271,
                longitude: -73.9754,
              },
            },
          },
        });
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    const preview = document.getElementById("libraryDetailPreview");
    expect(preview?.dataset.previewKind).toBe("map");
    expect(preview?.querySelector(".library-map-container")).toBeTruthy();
  });

  it("does not rebuild board document preview when revalidation returns the same image URL", async () => {
    const detailDeferred = createDeferred();
    const revalidationDeferred = createDeferred();
    let detailCalls = 0;

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_board_documents")) {
        return jsonResponse({
          message: {
            documents: [{
              name: "BOARD-DOC-1",
              title: "Skidpad sketch",
              command_count: 8,
              preview_image_url: "https://example.com/previews/board-1.png",
            }],
            total_count: 1,
            has_more: false,
            next_offset: 1,
          },
        });
      }

      if (url.includes("get_my_board_document_detail")) {
        detailCalls += 1;
        if (detailCalls === 1) return detailDeferred.promise;
        return revalidationDeferred.promise;
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="board_documents"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks();

    // Resolve initial detail
    detailDeferred.resolve(jsonResponse({
      message: {
        document: {
          name: "BOARD-DOC-1",
          title: "Skidpad sketch",
          command_count: 8,
          preview_image_url: "https://example.com/previews/board-1.png",
        },
      },
    }));
    await settleLibraryTasks();

    const preview = document.getElementById("libraryDetailPreview");
    const firstImg = preview?.querySelector("img");
    expect(firstImg?.src).toContain("board-1.png");

    // Resolve revalidation with identical data
    revalidationDeferred.resolve(jsonResponse({
      message: {
        document: {
          name: "BOARD-DOC-1",
          title: "Skidpad sketch",
          command_count: 8,
          preview_image_url: "https://example.com/previews/board-1.png",
        },
      },
    }));
    await settleLibraryTasks();

    // The same image element should be preserved — no flicker/rebuild.
    const secondImg = preview?.querySelector("img");
    expect(secondImg).toBe(firstImg);
    expect(secondImg?.src).toContain("board-1.png");
  });

  it("does not restart map preview animation when detail revalidation returns the same route", async () => {
    const detailDeferred = createDeferred();
    const revalidationDeferred = createDeferred();
    let detailCalls = 0;

    const routeCoords = [[-73.97, 40.85], [-73.975, 40.827]];
    const makeRecord = () => ({
      name: "SYNC-REPLAY-MAP",
      title: "Fort Lee",
      started_at_label: "2026-04-08 09:00:00",
      sample_count: 50,
      duration_ms: 180000,
      has_samples_payload: true,
      payload_complete: true,
      can_open: true,
      preview_route: { coordinates: routeCoords },
    });

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_speed_recordings")) {
        return jsonResponse({
          message: {
            records: [makeRecord()],
            total_count: 1,
            has_more: false,
            next_offset: 1,
          },
        });
      }

      if (url.includes("get_my_speed_recording_detail")) {
        detailCalls += 1;
        if (detailCalls === 1) return detailDeferred.promise;
        return revalidationDeferred.promise;
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    const preview = document.getElementById("libraryDetailPreview");
    const mapContainer = preview?.querySelector(".library-map-container");
    expect(mapContainer).toBeTruthy();

    // Resolve initial detail with preview_route
    detailDeferred.resolve(jsonResponse({
      message: { record: makeRecord() },
    }));
    await settleLibraryTasks();

    // Count becomes the baseline — the map preview was shown once here.
    const mapContainerAfterDetail = preview?.querySelector(".library-map-container");
    expect(mapContainerAfterDetail).toBeTruthy();

    // Resolve revalidation with same route
    revalidationDeferred.resolve(jsonResponse({
      message: { record: makeRecord() },
    }));
    await settleLibraryTasks();

    // Map container should be the same DOM node — not recreated.
    expect(preview?.querySelector(".library-map-container")).toBe(mapContainerAfterDetail);
  });

  it("dedupes preview across summary-first detail loading, response, and revalidation", async () => {
    const detailDeferred = createDeferred();
    const revalidationDeferred = createDeferred();
    let detailCalls = 0;
    let previewImgCreationCount = 0;

    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = originalCreateElement(tag);
      if (tag === "img") previewImgCreationCount += 1;
      return el;
    });

    try {
      window.fetch = createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_board_documents")) {
          return jsonResponse({
            message: {
              documents: [{
                name: "BOARD-DOC-1",
                title: "Skidpad sketch",
                command_count: 8,
                preview_image_url: "https://example.com/previews/board-1.png",
              }],
              total_count: 1,
              has_more: false,
              next_offset: 1,
            },
          });
        }

        if (url.includes("get_my_board_document_detail")) {
          detailCalls += 1;
          if (detailCalls === 1) return detailDeferred.promise;
          return revalidationDeferred.promise;
        }

        return jsonResponse({});
      });

      const libraryPage = await import("../../src/library/dev-harness.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="board_documents"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      await settleLibraryTasks();

      // Reset counter after initial list+tab rendering
      previewImgCreationCount = 0;

      // Resolve detail — same preview URL as summary
      detailDeferred.resolve(jsonResponse({
        message: {
          document: {
            name: "BOARD-DOC-1",
            title: "Skidpad sketch",
            command_count: 8,
            preview_image_url: "https://example.com/previews/board-1.png",
          },
        },
      }));
      await settleLibraryTasks();

      // Resolve revalidation — same preview URL
      revalidationDeferred.resolve(jsonResponse({
        message: {
          document: {
            name: "BOARD-DOC-1",
            title: "Skidpad sketch",
            command_count: 8,
            preview_image_url: "https://example.com/previews/board-1.png",
          },
        },
      }));
      await settleLibraryTasks();

      // Preview image should have been created at most once for the
      // detail+revalidation cycle since the URL never changed.
      expect(previewImgCreationCount).toBeLessThanOrEqual(1);
    } finally {
      createElementSpy.mockRestore();
    }
  });

  it("does not install a route-local Player launcher in the standalone harness", async () => {
    const libraryPage = await import("../../src/library/dev-harness.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    expect(document.querySelector("[data-player-toggle]")).toBeNull();
    expect(document.querySelector(".player-fab")).toBeNull();
  });
});
