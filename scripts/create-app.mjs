#!/usr/bin/env node
/* eslint-disable no-console */

import { constants as fsConstants } from "node:fs";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_APP_TYPES = new Set(["route", "window", "background"]);
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function usage() {
  return `
Usage:
  pnpm run create:app -- route notes
  pnpm run create:app -- window timer
  pnpm run create:app -- background offline-heartbeat

Options:
  --dry-run       Print files without writing them.
  --force         Allow writing into an existing app folder.
  --root <dir>    Repository root. Defaults to the current working directory.
  --help          Show this help.
`.trim();
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    force: false,
    root: process.cwd(),
    positionals: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--root") {
      const next = argv[index + 1];
      if (!next) throw new Error("--root requires a directory.");
      options.root = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option "${arg}".`);
    } else {
      options.positionals.push(arg);
    }
  }

  return options;
}

function validateAppType(type) {
  if (!VALID_APP_TYPES.has(type)) {
    throw new Error(`App type must be one of: ${Array.from(VALID_APP_TYPES).join(", ")}.`);
  }
}

function validateAppName(name) {
  if (!NAME_PATTERN.test(name)) {
    throw new Error("App name must be kebab-case, start with a letter, and contain only lowercase letters, numbers, and hyphens.");
  }
  if (name.includes("..") || name.includes("/") || name.includes("\\") || /\s/.test(name)) {
    throw new Error("App name cannot contain spaces, slashes, or path traversal.");
  }
}

function toPascalCase(name) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toCamelCase(name) {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toConstantName(name) {
  return name.toUpperCase().replaceAll("-", "_");
}

function q(value) {
  return JSON.stringify(value);
}

function routeFiles({ name, pascal, camel, constant, appId, route }) {
  const cssClass = `${name}-app`;
  const dataAttr = `data-${name}-app`;
  return {
    "index.ts": `export {
  ${constant}_APP_ID,
  mount,
} from "./${name}-route-app.js";
`,
    [`${name}-route-app.ts`]: `import "./${name}.less";

import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const ${constant}_APP_ID = ${q(appId)};

const template = \`
  <section class="${cssClass}" ${dataAttr}>
    <header class="${cssClass}__header">
      <h1>${pascal}</h1>
      <button type="button" data-${name}-action>Save</button>
    </header>
    <p data-${name}-status>Ready</p>
  </section>
\`;

function resolve${pascal}Runtime(routeContext: RouteMountContext): VatioAppRuntime | null {
  const runtime = routeContext.context.appRuntime || null;
  return runtime?.appId === ${constant}_APP_ID ? runtime : null;
}

function mount${pascal}(routeContext: RouteMountContext): MountedView {
  const runtime = resolve${pascal}Runtime(routeContext);
  const action = routeContext.root.querySelector("[data-${name}-action]") as HTMLButtonElement | null;
  const status = routeContext.root.querySelector("[data-${name}-status]");

  // TODO: Replace this sample interaction with the app's real route behavior.
  routeContext.cleanup.addEventListener(action, "click", () => {
    const openedAt = new Date().toISOString();
    runtime?.storage.setItem("lastActionAt", openedAt);
    if (status) status.textContent = \`Saved at \${openedAt}\`;
  });

  runtime?.logger.debug("${pascal} route app mounted.");
  return { unmount() {} };
}

const view = createRouteView({
  pageName: ${q(name)},
  template,
  meta: {
    title: "${pascal} - VatioBoard",
    description: "Local-first ${name} app for VatioBoard.",
    canonicalPath: ${q(route)},
    bodyClass: "${name}-page",
  },
  loadModule: () => Promise.resolve({}),
  mountController: (_module, routeContext) => mount${pascal}(routeContext),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
`,
    [`${name}.less`]: `.${cssClass} {
  min-height: 100%;
  padding: 24px;
}

.${cssClass}__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
`,
    "manifest.ts": `import { IconPages } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const ${camel}AppManifest = defineAppManifest({
  id: ${q(appId)},
  title: ${q(pascal)},
  shortTitle: ${q(pascal)},
  description: "Local-first ${name} app for VatioBoard.",
  kind: "core-app",
  version: "1.0.0",
  icon: IconPages,
  i18nKey: ${q(camel)},
  route: ${q(route)},
  entry: () => import("./index.js"),
  surfaces: ["main-route", "start-menu", "launcher"],
  order: 200,
  permissions: ["storage.app", "i18n.read", "settings.read", "shell.launchApp"],
  services: ["storage", "i18n", "settings", "shell"],
  tags: [${q(name)}, "local-first"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "experimental",
  metadata: {
    // TODO: Add compatibility metadata only if an adapter needs it.
  },
});
`,
  };
}

function windowFiles({ name, pascal, camel, constant, appId }) {
  const windowId = name;
  const cssClass = `${name}-window`;
  return {
    "index.ts": `export {
  ${constant}_APP_ID,
  ${constant}_WINDOW_ID,
  create${pascal}WindowApp,
  createShellWindowApp,
} from "./${name}-window-app.js";
`,
    [`${name}-window-app.ts`]: `import "./${name}.less";

import type { ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";

export const ${constant}_APP_ID = ${q(appId)};
export const ${constant}_WINDOW_ID = ${q(windowId)};

interface ${pascal}WindowOptions {
  mount?: HTMLElement | null;
  shellManager?: ShellRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  runtime?: VatioAppRuntime | null;
}

function resolve${pascal}Runtime(options: ${pascal}WindowOptions): VatioAppRuntime | null {
  if (options.runtime?.appId === ${constant}_APP_ID) return options.runtime;
  return options.shellAppRuntimeManager?.getRuntime(${constant}_APP_ID)
    || options.shellAppRuntimeManager?.ensureRuntime(${constant}_APP_ID)
    || null;
}

export function create${pascal}WindowApp(options: ${pascal}WindowOptions = {}) {
  const runtime = resolve${pascal}Runtime(options);
  const shellManager = options.shellManager || runtime?.shell.shellManager || null;
  const mount = options.mount || document.body;
  const existing = shellManager?.getWindow(${constant}_WINDOW_ID);
  if (existing) return { runtime, record: existing };

  if (!shellManager) {
    runtime?.logger.warn("${pascal} requires a shell window manager.");
    return { runtime, record: null };
  }

  const element = document.createElement("section");
  element.className = "${cssClass}";
  element.innerHTML = \`
    <header class="${cssClass}__header">
      <h2>${pascal}</h2>
    </header>
    <p data-${name}-status>Ready</p>
  \`;
  mount.append(element);

  const record = shellManager.registerWindow({
    id: ${constant}_WINDOW_ID,
    title: ${q(pascal)},
    element,
    bounds: { left: 48, top: 96, width: 320, height: 240 },
    capabilities: {
      draggable: true,
      resizable: true,
      minimizable: true,
      closable: true,
      restorable: true,
    },
    lifecycle: {
      // TODO: Add app-specific lifecycle work if needed.
      destroy() {
        element.remove();
      },
    },
  });

  runtime?.storage.setItem("lastOpenedAt", new Date().toISOString());
  runtime?.logger.debug("${pascal} shell-window app registered.");
  return { runtime, record, element };
}

export const createShellWindowApp = create${pascal}WindowApp;
`,
    [`${name}.less`]: `.${cssClass} {
  min-width: 280px;
  min-height: 180px;
  padding: 18px;
}

.${cssClass}__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
`,
    "manifest.ts": `import { IconTime } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const ${camel}AppManifest = defineAppManifest({
  id: ${q(appId)},
  title: ${q(pascal)},
  shortTitle: ${q(pascal)},
  description: "Floating ${name} tool for VatioBoard.",
  kind: "tool-app",
  version: "1.0.0",
  icon: IconTime,
  i18nKey: ${q(camel)},
  entry: () => import("./index.js"),
  surfaces: ["shell-window", "start-menu", "taskbar", "launcher"],
  order: 200,
  permissions: ["storage.app", "i18n.read", "settings.read", "settings.write", "shell.window"],
  services: ["shell", "storage", "i18n", "settings"],
  window: {
    shellWindowId: ${q(windowId)},
    mode: "floating",
    defaultBounds: { left: 48, top: 96, width: 320, height: 240 },
    capabilities: {
      draggable: true,
      resizable: true,
      minimizable: true,
      closable: true,
      restorable: true,
    },
    restoreOnBoot: true,
    lazy: true,
  },
  tags: ["tool", ${q(name)}],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "experimental",
  metadata: {
    // TODO: Add legacyToolId only when a legacy adapter needs a stable tool id.
  },
});
`,
  };
}

function backgroundFiles({ name, pascal, camel, constant, appId }) {
  return {
    "index.ts": `export {
  ${constant}_APP_ID,
  createBackgroundServiceApp,
} from "./${name}-service.js";
`,
    [`${name}-service.ts`]: `import type { VatioAppRuntime } from "../../app-platform/types";

export const ${constant}_APP_ID = ${q(appId)};

export function createBackgroundServiceApp({
  runtime,
  signal,
}: {
  runtime: VatioAppRuntime;
  signal?: AbortSignal;
}) {
  let timer = 0;

  function clearTimer() {
    if (timer) window.clearInterval(timer);
    timer = 0;
  }

  function writeHeartbeat() {
    runtime.storage.setItem("lastHeartbeatAt", new Date().toISOString());
  }

  signal?.addEventListener("abort", clearTimer, { once: true });

  return {
    start() {
      // TODO: Replace this heartbeat with the service's real background work.
      writeHeartbeat();
      clearTimer();
      timer = window.setInterval(writeHeartbeat, 60_000);
      runtime.logger.debug("${pascal} background service started.");
    },
    suspend() {
      clearTimer();
    },
    resume() {
      this.start?.();
    },
    stop() {
      clearTimer();
    },
    destroy() {
      clearTimer();
    },
  };
}
`,
    "manifest.ts": `import { IconPages } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const ${camel}AppManifest = defineAppManifest({
  id: ${q(appId)},
  title: ${q(pascal)},
  shortTitle: ${q(pascal)},
  description: "Background ${name} service for VatioBoard.",
  kind: "background-service",
  version: "1.0.0",
  icon: IconPages,
  i18nKey: ${q(camel)},
  entry: () => import("./index.js"),
  surfaces: ["background", "app-manager"],
  order: 220,
  permissions: ["storage.app", "i18n.read", "settings.read"],
  services: ["storage", "i18n", "settings"],
  lifecycle: {
    autostart: false,
    keepAlive: false,
    restoreOnBoot: false,
  },
  tags: ["background", ${q(name)}],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "internal",
  metadata: {
    // TODO: Set protected: true only for system-critical services.
  },
});
`,
  };
}

function buildFiles(type, name) {
  const pascal = toPascalCase(name);
  const camel = toCamelCase(name);
  const constant = toConstantName(name);
  const appId = `vatio.${camel}`;
  const route = `/${name}`;
  const context = { name, pascal, camel, constant, appId, route };

  if (type === "route") return routeFiles(context);
  if (type === "window") return windowFiles(context);
  return backgroundFiles(context);
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertCanWriteAppDir(appDir, force) {
  if (!(await exists(appDir))) return;
  const stats = await stat(appDir);
  if (!stats.isDirectory()) {
    throw new Error(`Cannot create app because "${appDir}" exists and is not a directory.`);
  }
  if (!force) {
    throw new Error(`App folder "${appDir}" already exists. Re-run with --force to overwrite generated files.`);
  }
}

function printNextSteps({ type, name, camel }) {
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Import ${camel}AppManifest in src/app-platform/builtin-apps.ts.`);
  console.log("  2. Add the manifest to BUILTIN_APP_MANIFESTS in the desired order.");
  console.log("  3. Add an i18n key if the app title needs translation.");
  console.log("  4. Add manifest, launch, storage, permission, service, and cleanup tests.");
  if (type === "route") console.log(`  5. Visit /${name} after registration.`);
  if (type === "window") console.log(`  5. Open vatio.${camel} through the launcher after registration.`);
  if (type === "background") console.log(`  5. Start vatio.${camel} through createBackgroundServiceManager() after registration.`);
  console.log("  6. Run pnpm run verify.");
}

async function writeGeneratedFiles({ appDir, files, dryRun }) {
  const entries = Object.entries(files);
  if (dryRun) {
    console.log("Dry run. Files that would be written:");
    for (const [relativePath] of entries) console.log(`  ${path.join(appDir, relativePath)}`);
    return;
  }

  await mkdir(appDir, { recursive: true });
  for (const [relativePath, contents] of entries) {
    await writeFile(path.join(appDir, relativePath), contents, "utf8");
  }
}

export async function createApp(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const [type, name] = options.positionals;
  if (!type || !name || options.positionals.length > 2) {
    throw new Error(`${usage()}\n\nExpected an app type and app name.`);
  }

  validateAppType(type);
  validateAppName(name);

  const rootDir = path.resolve(options.root);
  const appsRoot = path.join(rootDir, "src", "apps");
  const appDir = path.join(appsRoot, name);
  const relativeAppDir = path.relative(appsRoot, appDir);
  if (relativeAppDir.startsWith("..") || path.isAbsolute(relativeAppDir)) {
    throw new Error("Resolved app folder escaped src/apps.");
  }

  await assertCanWriteAppDir(appDir, options.force || options.dryRun);
  const files = buildFiles(type, name);
  await writeGeneratedFiles({ appDir, files, dryRun: options.dryRun });

  const action = options.dryRun ? "Prepared" : "Created";
  console.log(`${action} ${type} app "${name}" at ${appDir}.`);
  printNextSteps({ type, name, camel: toCamelCase(name) });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  createApp().catch((error) => {
    console.error(`create-app: ${error.message}`);
    process.exitCode = 1;
  });
}
