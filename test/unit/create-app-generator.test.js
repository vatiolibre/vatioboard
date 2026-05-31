import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../scripts/create-app.mjs";

const tempRoots = [];

async function makeTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vatioboard-create-app-"));
  tempRoots.push(root);
  return root;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("create-app generator", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    while (tempRoots.length) {
      await rm(tempRoots.pop(), { recursive: true, force: true });
    }
  });

  it("rejects invalid app names", async () => {
    const root = await makeTempRoot();

    await expect(createApp(["route", "Bad Name", "--root", root])).rejects.toThrow(/kebab-case/);
    await expect(createApp(["route", "../notes", "--root", root])).rejects.toThrow(/kebab-case|path traversal/);
  });

  it("supports dry runs without writing files", async () => {
    const root = await makeTempRoot();

    await createApp(["route", "notes", "--root", root, "--dry-run"]);

    await expect(fileExists(path.join(root, "src", "apps", "notes"))).resolves.toBe(false);
  });

  it("generates route, window, and background app skeletons", async () => {
    const root = await makeTempRoot();

    await createApp(["route", "notes", "--root", root]);
    await createApp(["window", "timer", "--root", root]);
    await createApp(["background", "offline-heartbeat", "--root", root]);

    const notesManifest = await readFile(path.join(root, "src", "apps", "notes", "manifest.ts"), "utf8");
    const timerWindow = await readFile(path.join(root, "src", "apps", "timer", "timer-window-app.ts"), "utf8");
    const backgroundService = await readFile(
      path.join(root, "src", "apps", "offline-heartbeat", "offline-heartbeat-service.ts"),
      "utf8",
    );

    expect(notesManifest).toContain("defineAppManifest");
    expect(notesManifest).toContain('route: "/notes"');
    expect(await fileExists(path.join(root, "src", "apps", "notes", "notes-route-app.ts"))).toBe(true);
    expect(timerWindow).toContain("createShellWindowApp");
    expect(await fileExists(path.join(root, "src", "apps", "timer", "timer.less"))).toBe(true);
    expect(backgroundService).toContain("createBackgroundServiceApp");
  });

  it("does not overwrite an existing app folder unless forced", async () => {
    const root = await makeTempRoot();

    await createApp(["route", "notes", "--root", root]);
    await expect(createApp(["route", "notes", "--root", root])).rejects.toThrow(/already exists/);
    await expect(createApp(["route", "notes", "--root", root, "--force"])).resolves.toBeUndefined();
  });
});

