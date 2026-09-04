import { expect, vi } from "vitest";

export function resetRouteAppTestDom({ globals = [] } = {}) {
  localStorage.clear();
  document.body.innerHTML = "";
  for (const key of globals) {
    delete window[key];
  }
}

export function cleanupRouteAppTestDom() {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.resetModules();
}

export async function loadRouteAppModules(appModulePath) {
  vi.resetModules();
  const [appPlatform, routeApp] = await Promise.all([
    import("../../src/app-platform/index.js"),
    import(appModulePath),
  ]);
  return {
    ...appPlatform,
    ...routeApp,
  };
}

export function createRouteTestRoot() {
  const root = document.createElement("main");
  document.body.append(root);
  return root;
}

export function createRouteMountContext({ runtime, manifest, path, url = path, requestedPath = path } = {}) {
  return {
    appRuntime: runtime,
    appManifest: manifest,
    route: { path, url, query: new URLSearchParams(url.split("?")[1] || ""), requestedPath },
    routeSignal: new AbortController().signal,
    navigate: vi.fn(() => true),
    emitRouteVisible: vi.fn(),
  };
}

export async function expectManifestEntryResolvesRouteApp({
  modules,
  appId,
  appIdExport,
  expectedRoute,
  expectedAliases = [],
}) {
  const manifest = modules.appRegistry.getApp(appId);
  const routeModule = await manifest.entry();

  expect(manifest.route).toBe(expectedRoute);
  for (const alias of expectedAliases) {
    expect(manifest.aliases).toContain(alias);
  }
  expect(routeModule[appIdExport]).toBe(appId);
  expect(routeModule.mount).toBe(modules.mount);

  return { manifest, routeModule };
}

export async function mountRouteAppWithRuntime({
  modules,
  appId,
  baseContext = {},
  path,
  url = path,
  requestedPath = path,
}) {
  const manifest = modules.appRegistry.getApp(appId);
  const runtime = modules.createAppRuntime({ manifest, baseContext });
  const root = createRouteTestRoot();
  const mounted = await modules.mount(root, createRouteMountContext({
    runtime,
    manifest,
    path,
    url,
    requestedPath,
  }));

  return { manifest, mounted, root, runtime };
}

export function expectCommonRuntimeSeams(routeContext, { runtime, manifest }) {
  expect(routeContext.appRuntime).toBe(runtime);
  expect(routeContext.appManifest).toBe(manifest);
  expect(routeContext.appStorage).toBe(runtime.storage);
  expect(routeContext.settingsService).toBe(runtime.services.settings);
  expect(routeContext.context.appRuntime).toBe(runtime);
}

export function expectRuntimeServiceSeams(routeContext, runtime, seamMap) {
  for (const [contextKey, serviceKey] of Object.entries(seamMap)) {
    expect(routeContext[contextKey]).toBe(runtime.services[serviceKey]);
  }
}

export function expectNoRuntimeSeams(routeContext, keys) {
  expect(routeContext.appRuntime).toBeNull();
  for (const key of keys) {
    expect(routeContext[key]).toBeNull();
  }
}
