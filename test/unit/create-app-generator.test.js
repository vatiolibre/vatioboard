import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as ts from "typescript";
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

async function collectFiles(dir, predicate, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(entryPath, predicate, files);
    } else if (predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
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

  it("generates TypeScript that parses and references existing icon exports", async () => {
    const root = await makeTempRoot();

    await createApp(["route", "notes", "--root", root]);
    await createApp(["window", "timer", "--root", root]);
    await createApp(["background", "offline-heartbeat", "--root", root]);

    const tsFiles = await collectFiles(path.join(root, "src", "apps"), (filePath) => filePath.endsWith(".ts"));
    expect(tsFiles.length).toBeGreaterThan(0);
    for (const filePath of tsFiles) {
      const source = await readFile(filePath, "utf8");
      const result = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          isolatedModules: true,
        },
        fileName: filePath,
        reportDiagnostics: true,
      });
      const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
      expect(errors.map((diagnostic) => diagnostic.messageText)).toEqual([]);
    }

    const iconSource = await readFile(path.resolve("src", "icons.ts"), "utf8");
    const iconExports = new Set(
      Array.from(iconSource.matchAll(/export const (Icon[A-Za-z0-9_]+)/g)).map((match) => match[1]),
    );
    const manifestFiles = tsFiles.filter((filePath) => filePath.endsWith(`${path.sep}manifest.ts`));
    expect(manifestFiles).toHaveLength(3);
    for (const manifestPath of manifestFiles) {
      const source = await readFile(manifestPath, "utf8");
      const iconImport = source.match(/import \{ ([^}]+) \} from "\.\.\/\.\.\/icons\.js";/);
      expect(iconImport).toBeTruthy();
      for (const iconName of iconImport[1].split(",").map((name) => name.trim())) {
        expect(iconExports.has(iconName)).toBe(true);
      }
      expect(source).toContain('import { defineAppManifest } from "../../app-platform/manifest.js";');
      expect(source).toContain('entry: () => import("./index.js")');
    }
  });

  it("does not overwrite an existing app folder unless forced", async () => {
    const root = await makeTempRoot();

    await createApp(["route", "notes", "--root", root]);
    await expect(createApp(["route", "notes", "--root", root])).rejects.toThrow(/already exists/);
    await expect(createApp(["route", "notes", "--root", root, "--force"])).resolves.toBeUndefined();
  });
});
