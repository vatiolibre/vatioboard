import { getRouteConfig } from "./route-registry.js";

const ROUTE_CHANGE_EVENT = "vatioboard:routechange";
const ROUTE_VISIBLE_EVENT = "vatioboard:route-visible";

let activeRoute = null;
let activeRouteHash = "";
let routeChangeHandler = null;
let restoringHash = false;
let pendingRouteHash = "";

function normalizePath(path) {
  const value = String(path || "").trim();
  if (!value || value === "/") return "/";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : "/";
}

function createQuery(search = "") {
  const raw = String(search || "");
  return new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
}

export function parseAppHash(hash = window.location.hash) {
  let raw = String(hash || "").replace(/^#/, "");
  if (!raw || raw === "/") {
    return {
      path: "/",
      query: new URLSearchParams(),
      hash: "#/",
    };
  }

  if (!raw.startsWith("/")) raw = `/${raw}`;
  const queryIndex = raw.indexOf("?");
  const path = normalizePath(queryIndex === -1 ? raw : raw.slice(0, queryIndex));
  const query = createQuery(queryIndex === -1 ? "" : raw.slice(queryIndex + 1));
  const queryString = query.toString();

  return {
    path,
    query,
    hash: `#${path}${queryString ? `?${queryString}` : ""}`,
  };
}

export function getCurrentAppRoute() {
  if (window.location.hash) {
    const route = parseAppHash(window.location.hash);
    const searchQuery = new URLSearchParams(window.location.search);
    for (const [key, value] of searchQuery.entries()) {
      if (!route.query.has(key)) route.query.set(key, value);
    }
    return route;
  }

  return {
    path: "",
    query: new URLSearchParams(window.location.search),
    hash: "",
  };
}

export function getCurrentAppRouteQuery() {
  return getCurrentAppRoute().query;
}

export function toAppRouteHash(href) {
  const value = String(href || "").trim();
  if (!value) return "";

  if (value.startsWith("#/")) return parseAppHash(value).hash;

  let url;
  try {
    url = new URL(value, window.location.origin);
  } catch {
    return "";
  }

  if (url.origin !== window.location.origin) return "";
  if (url.hash.startsWith("#/")) return parseAppHash(url.hash).hash;

  const pathname = normalizePath(url.pathname);
  if (!getRouteConfig(pathname)) return "";
  return `#${pathname}${url.search || ""}`;
}

export function canNavigateAway(fromRoute = activeRoute) {
  if (!fromRoute) return true;

  if (fromRoute.path === "/accel" && typeof window.__vatioboardCanLeaveAccel === "function") {
    return window.__vatioboardCanLeaveAccel() !== false;
  }

  return true;
}

export function navigateToAppRoute(href, { replace = false } = {}) {
  const hash = toAppRouteHash(href);
  if (!hash) {
    window.location.href = href;
    return false;
  }

  if (!canNavigateAway(activeRoute)) return false;

  if (replace) {
    window.location.replace(hash);
  } else if (window.location.hash === hash) {
    routeChangeHandler?.();
  } else {
    window.location.hash = hash;
  }
  return true;
}

export function replaceAppRouteQuery(nextQuery = {}) {
  const route = parseAppHash(window.location.hash || "#/");
  const query = new URLSearchParams(route.query);

  for (const [key, value] of Object.entries(nextQuery)) {
    if (value === null || value === undefined || value === "") {
      query.delete(key);
    } else {
      query.set(key, String(value));
    }
  }

  const queryString = query.toString();

  if (!window.location.hash) {
    const url = new URL(window.location.href);
    url.search = queryString;
    window.history.replaceState({}, "", url);
    return;
  }

  const nextHash = `#${route.path}${queryString ? `?${queryString}` : ""}`;
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${nextHash}`);
  activeRouteHash = nextHash;
}

export function emitRouteVisible(route) {
  window.dispatchEvent(
    new CustomEvent(ROUTE_VISIBLE_EVENT, {
      detail: route,
    }),
  );
}

export function createHashRouter({ routes, onRouteChange }) {
  routeChangeHandler = async () => {
    if (restoringHash) {
      restoringHash = false;
      return;
    }

    const nextRoute = parseAppHash(window.location.hash || "#/");
    if (activeRoute && nextRoute.hash === activeRouteHash) return;
    if (pendingRouteHash === nextRoute.hash) return;

    if (activeRoute && nextRoute.hash !== activeRouteHash && !canNavigateAway(activeRoute)) {
      restoringHash = true;
      window.location.hash = activeRouteHash || "#/";
      return;
    }

    const routeConfig = routes.find((route) => route.path === nextRoute.path)
      || routes.find((route) => route.aliases?.includes(nextRoute.path))
      || routes.find((route) => route.path === "/");

    const resolvedRoute = {
      ...nextRoute,
      path: routeConfig?.path || nextRoute.path,
      requestedPath: nextRoute.path,
      config: routeConfig,
      navigate: navigateToAppRoute,
      replace: (href) => navigateToAppRoute(href, { replace: true }),
    };

    activeRoute = resolvedRoute;
    activeRouteHash = nextRoute.hash;
    pendingRouteHash = nextRoute.hash;
    window.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT, { detail: resolvedRoute }));
    try {
      await onRouteChange(resolvedRoute);
    } finally {
      if (pendingRouteHash === nextRoute.hash) pendingRouteHash = "";
    }
  };

  if (!window.location.hash) {
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#/`);
  }

  window.addEventListener("hashchange", routeChangeHandler);
  void routeChangeHandler();

  return {
    getRoute: () => activeRoute,
    destroy() {
      window.removeEventListener("hashchange", routeChangeHandler);
      routeChangeHandler = null;
      pendingRouteHash = "";
    },
  };
}

export { ROUTE_CHANGE_EVENT, ROUTE_VISIBLE_EVENT };
