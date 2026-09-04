import { getRouteConfig } from "./route-registry.js";
import type { AppRoute, RouteConfig } from "../types/route";

const ROUTE_CHANGE_EVENT = "vatioboard:routechange";
const ROUTE_VISIBLE_EVENT = "vatioboard:route-visible";
const HISTORY_INDEX_KEY = "__vatioboardRouteIndex";

type RouteChangeSource = "initial" | "navigate" | "popstate";

let activeRoute: AppRoute | null = null;
let activeRouteUrl = "";
let routeChangeHandler: ((source?: RouteChangeSource, targetIndex?: number | null) => Promise<void>) | null = null;
let restoringHistory = false;
let pendingRouteUrl = "";
let activeHistoryIndex = 0;

function normalizePath(path: string) {
  const value = String(path || "").trim();
  if (!value || value === "/") return "/";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : "/";
}

function createQuery(search = "") {
  const raw = String(search || "");
  return new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
}

function createRouteUrl(path: string, query: URLSearchParams) {
  const queryString = query.toString();
  return `${normalizePath(path)}${queryString ? `?${queryString}` : ""}`;
}

function getHistoryIndex(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[HISTORY_INDEX_KEY];
  return Number.isInteger(value) ? Number(value) : null;
}

function withHistoryIndex(state: unknown, index: number) {
  const existing = state && typeof state === "object" ? state as Record<string, unknown> : {};
  return { ...existing, [HISTORY_INDEX_KEY]: index };
}

export function parseAppLocation(location: Pick<Location, "pathname" | "search"> = window.location) {
  const path = normalizePath(location.pathname || "/");
  const query = createQuery(location.search);
  return {
    path,
    query,
    url: createRouteUrl(path, query),
  };
}

export function getCurrentAppRoute() {
  return parseAppLocation(window.location);
}

export function getCurrentAppRouteQuery() {
  return getCurrentAppRoute().query;
}

export function toAppRouteUrl(href: string) {
  const value = String(href || "").trim();
  if (!value) return "";
  if (value.startsWith("#")) return "";

  let url: URL;
  try {
    url = new URL(value, window.location.origin);
  } catch {
    return "";
  }

  if (url.origin !== window.location.origin) return "";
  if (url.hash) return "";
  const pathname = normalizePath(url.pathname);
  const config = getRouteConfig(pathname);
  if (!config) return "";
  return `${config.path}${url.search || ""}`;
}

export function canNavigateAway(fromRoute = activeRoute) {
  if (!fromRoute) return true;

  if (fromRoute.path === "/accel" && typeof window.__vatioboardCanLeaveAccel === "function") {
    return window.__vatioboardCanLeaveAccel() !== false;
  }

  return true;
}

export function navigateToAppRoute(href: string, { replace = false } = {}) {
  const routeUrl = toAppRouteUrl(href);
  if (!routeUrl) {
    window.location.href = href;
    return false;
  }

  if (!canNavigateAway(activeRoute)) return false;

  if (replace) {
    window.history.replaceState(withHistoryIndex(window.history.state, activeHistoryIndex), "", routeUrl);
  } else if (activeRouteUrl !== routeUrl) {
    activeHistoryIndex += 1;
    window.history.pushState(withHistoryIndex({}, activeHistoryIndex), "", routeUrl);
  }

  void routeChangeHandler?.("navigate", activeHistoryIndex);
  return true;
}

export function replaceAppRouteQuery(nextQuery: Record<string, unknown> = {}) {
  const route = parseAppLocation(window.location);
  const query = new URLSearchParams(route.query);

  for (const [key, value] of Object.entries(nextQuery)) {
    if (value === null || value === undefined || value === "") {
      query.delete(key);
    } else {
      query.set(key, String(value));
    }
  }

  const config = getRouteConfig(route.path);
  const nextUrl = createRouteUrl(config?.path || route.path, query);
  window.history.replaceState(withHistoryIndex(window.history.state, activeHistoryIndex), "", nextUrl);
  activeRouteUrl = nextUrl;
  if (activeRoute) {
    activeRoute.query = query;
    activeRoute.url = nextUrl;
  }
}

export function emitRouteVisible(route: AppRoute) {
  window.dispatchEvent(
    new CustomEvent(ROUTE_VISIBLE_EVENT, {
      detail: route,
    }),
  );
}

export function createHistoryRouter({
  routes,
  onRouteChange,
}: {
  routes: readonly RouteConfig[];
  onRouteChange: (route: AppRoute) => Promise<void> | void;
}) {
  routeChangeHandler = async (source = "navigate", targetIndex = null) => {
    if (restoringHistory) {
      restoringHistory = false;
      return;
    }

    const requestedRoute = parseAppLocation(window.location);
    const routeConfig = routes.find((route) => route.path === requestedRoute.path)
      || routes.find((route) => route.aliases?.includes(requestedRoute.path))
      || routes.find((route) => route.path === "/");
    if (!routeConfig) return;

    const canonicalUrl = createRouteUrl(routeConfig.path, requestedRoute.query);
    if (activeRoute && canonicalUrl === activeRouteUrl) return;
    if (pendingRouteUrl === canonicalUrl) return;

    if (source === "popstate" && activeRoute && !canNavigateAway(activeRoute)) {
      if (targetIndex !== null && targetIndex !== activeHistoryIndex) {
        restoringHistory = true;
        window.history.go(activeHistoryIndex - targetIndex);
      } else {
        window.history.pushState(
          withHistoryIndex({}, activeHistoryIndex),
          "",
          activeRouteUrl || createRouteUrl(activeRoute.path, activeRoute.query),
        );
      }
      return;
    }

    if (canonicalUrl !== requestedRoute.url || window.location.hash) {
      window.history.replaceState(
        withHistoryIndex(window.history.state, targetIndex ?? activeHistoryIndex),
        "",
        canonicalUrl,
      );
    }

    if (targetIndex !== null) activeHistoryIndex = targetIndex;
    const resolvedRoute: AppRoute = {
      ...requestedRoute,
      url: canonicalUrl,
      path: routeConfig.path,
      requestedPath: requestedRoute.path,
      config: routeConfig,
      navigate: navigateToAppRoute,
      replace: (href) => navigateToAppRoute(href, { replace: true }),
    };

    activeRoute = resolvedRoute;
    activeRouteUrl = canonicalUrl;
    pendingRouteUrl = canonicalUrl;
    window.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT, { detail: resolvedRoute }));
    try {
      await onRouteChange(resolvedRoute);
    } finally {
      if (pendingRouteUrl === canonicalUrl) pendingRouteUrl = "";
    }
  };

  activeHistoryIndex = getHistoryIndex(window.history.state) ?? 0;
  const initialRoute = parseAppLocation(window.location);
  window.history.replaceState(
    withHistoryIndex(window.history.state, activeHistoryIndex),
    "",
    initialRoute.url,
  );
  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

  const onPopState = (event: PopStateEvent) => {
    void routeChangeHandler?.("popstate", getHistoryIndex(event.state));
  };

  window.addEventListener("popstate", onPopState);
  void routeChangeHandler("initial", activeHistoryIndex);

  return {
    getRoute: () => activeRoute,
    destroy() {
      window.removeEventListener("popstate", onPopState);
      routeChangeHandler = null;
      pendingRouteUrl = "";
      activeRoute = null;
      activeRouteUrl = "";
    },
  };
}

export { ROUTE_CHANGE_EVENT, ROUTE_VISIBLE_EVENT };
