import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

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
  return vi.fn(async (input) => {
    const url = typeof input === "string" ? input : String(input?.url ?? "");

    if (url.includes("/api/method/vatiolibre.services.tesla_connection_status")) {
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
            saved_drawings: {
              enabled: true,
            },
          },
        },
      });
    }

    return handler(url);
  });
}

describe("library.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");

      if (url.includes("/api/method/vatiolibre.services.tesla_connection_status")) {
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
              saved_drawings: {
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
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.drawings.list_my_saved_drawings")) {
        return new Response(JSON.stringify({
          message: {
            drawings: [
              {
                name: "DRAW-1",
                title: "Skidpad export",
                created_at_label: "2026-04-03 08:30:00",
                modified_at_label: "2026-04-03 09:15:00",
                image_width: 1920,
                image_height: 1080,
                file_size: 245760,
                folder_label: "Exports",
                image_url: "https://www.vatiolibre.com/files/skidpad.png?token=view#preview",
                download_url: "https://www.vatiolibre.com/private/files/skidpad.png?download=1",
                export_url: "https://www.vatiolibre.com/api/method/vatiolibre.vatiolibre.drawings.download_my_saved_drawing?name=DRAW-1&as_attachment=1",
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

      if (url.includes("/api/method/vatiolibre.vatiolibre.drawings.get_my_saved_drawing_detail")) {
        return new Response(JSON.stringify({
          message: {
            drawing: {
              name: "DRAW-1",
              title: "Skidpad export",
              created_at_label: "2026-04-03 08:30:00",
              modified_at_label: "2026-04-03 09:15:00",
              image_width: 1920,
              image_height: 1080,
              file_size: 245760,
              folder_label: "Exports",
              image_url: "https://www.vatiolibre.com/files/skidpad.png?token=view#preview",
              download_url: "https://www.vatiolibre.com/private/files/skidpad.png?download=1",
              export_url: "https://www.vatiolibre.com/api/method/vatiolibre.vatiolibre.drawings.download_my_saved_drawing?name=DRAW-1&as_attachment=1",
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

  it("loads cloud library summaries and lazy detail without requesting payloads", async () => {
    const libraryPage = await import("../../src/library/library.js");
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
    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining("include_payload=0"),
      expect.anything()
    );
  });

  it("disables open when a replay only has summary metadata", async () => {
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelectorAll(".library-record")[1]?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks();

    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Bridge run");
    expect(document.getElementById("libraryActionOpen")?.disabled).toBe(true);
  });

  it("uses the shared launcher chrome and keeps auth controls inside the menu", async () => {
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    expect(document.querySelector(".header-inner.library-header-inner")).toBeTruthy();
    expect(document.querySelector(".brand .brand-home")).toBeTruthy();
    expect(document.getElementById("libraryToolsMenuBtn")).toBeTruthy();
    expect(document.getElementById("libraryRefresh")?.querySelector("svg")).toBeTruthy();
    expect(document.querySelector(".library-account-panel")).toBeNull();
    expect(document.querySelector(".library-hero")).toBeNull();

    const toolsMenuButton = document.getElementById("libraryToolsMenuBtn");
    const toolsMenuList = document.getElementById("libraryToolsMenuList");
    expect(toolsMenuList?.hidden).toBe(true);
    toolsMenuButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleLibraryTasks(2);

    expect(toolsMenuButton?.getAttribute("aria-expanded")).toBe("true");
    expect(toolsMenuList?.hidden).toBe(false);
    expect(document.querySelector("#libraryToolsMenuList [data-backend-auth]")).toBeTruthy();
    expect(document.querySelector("#libraryToolsMenuList [data-backend-auth]")?.dataset.authState).toBe("authenticated");
    expect(document.getElementById("openLibraryReplayMenu")).toBeTruthy();
    expect(document.getElementById("openLibraryGpsLabMenu")).toBeTruthy();
    expect(document.getElementById("openLibraryCurrentMenu")?.disabled).toBe(true);
  });

  it("switches to board documents and renders their summary-first detail", async () => {
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="board_documents"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settleLibraryTasks();

    expect(document.querySelector('[data-tab="board_documents"]')?.dataset.active).toBe("true");
    expect(document.querySelectorAll(".library-record")).toHaveLength(1);
    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Skidpad sketch");
  });

  it("loads saved-image previews and downloads through the BFF origin", async () => {
    const clickedHrefs = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function mockAnchorClick() {
        clickedHrefs.push(this.href);
      });

    try {
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="saved_images"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      await settleLibraryTasks();

      const previewImage = document.querySelector("#libraryDetailPreview img");
      expect(previewImage?.getAttribute("src")).toBe(
        "https://api.vatioboard.com/files/skidpad.png?token=view#preview"
      );

      document.getElementById("libraryActionDownload")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      await settleLibraryTasks(2);

      expect(clickedHrefs).toEqual([
        "https://api.vatioboard.com/private/files/skidpad.png?download=1",
      ]);
      expect(previewImage?.getAttribute("src")).not.toContain("vatiolibre.com");
      expect(clickedHrefs[0]).not.toContain("vatiolibre.com");
    } finally {
      clickSpy.mockRestore();
    }
  });

  it("keeps appended items when the initial background revalidation resolves later", async () => {
    const revalidation = createDeferred();
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

        if (offset === 0) {
          return revalidation.promise;
        }

        if (offset === 2) {
          return loadMore.promise;
        }
      }

      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.get_my_speed_recording_detail")) {
        const recordName = new URL(url).searchParams.get("name");
        return jsonResponse({
          message: {
            record: {
              name: recordName,
              title: recordName === "SYNC-REPLAY-2" ? "Bridge run" : "Downtown loop",
              started_at_label: "2026-04-02 10:00:00",
            },
          },
        });
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    expect(speedListCalls).toBeGreaterThanOrEqual(2);
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

    revalidation.resolve(jsonResponse({
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

    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    expect(document.getElementById("libraryStatus")?.textContent).toBe(
      "Sign in with your VatioLibre account to browse your cloud library on this device."
    );
    expect(document.getElementById("libraryListEmpty")?.textContent).toBe(
      "Sign in with your VatioLibre account to browse your cloud library on this device."
    );
    expect(document.getElementById("libraryAuthSummaryTitle")?.textContent).toBe("Signed out");
    expect(document.querySelectorAll(".library-record")).toHaveLength(0);
  });

  it("surfaces a 403 list response as access denied instead of an empty success", async () => {
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("/api/method/vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings")) {
        return jsonResponse({ message: "Forbidden" }, 403);
      }

      return jsonResponse({});
    });

    const libraryPage = await import("../../src/library/library.js");
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

  it("surfaces a 500 detail response as an error instead of rendering empty detail success", async () => {
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

    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    expect(document.getElementById("libraryStatus")?.textContent).toBe(
      "Could not load this cloud record (500)"
    );
    expect(document.getElementById("libraryDetailTitle")?.textContent).toBe("Downtown loop");
    expect(document.querySelectorAll(".library-record")).toHaveLength(1);
  });
});
