import { createCleanupStack } from "../view-cleanup.js";
import { initFocusedWorkspaces } from "../../shared/focused-workspace.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";

interface RouteMeta {
  title?: string;
  description?: string;
  canonicalPath?: string;
  bodyClass?: string | string[];
  bodyClasses?: string | string[];
  cleanupBodyClasses?: string | string[];
}

interface RouteViewConfig {
  pageName?: string;
  template?: string;
  meta?: RouteMeta;
  loadModule: () => Promise<unknown> | unknown;
  mountController?: (routeModule: unknown, context: RouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountController?: (routeModule: unknown, context: RouteMountContext) => void;
}

type RouteViewRuntimeContext = Partial<RouteContext> & {
  routeSignal?: AbortSignal;
};

const templateCache = new Map<string, HTMLTemplateElement>();

function normalizeClassList(value?: string | string[] | null) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value).split(/\s+/).filter(Boolean);
}

function resolveCanonicalHref(canonicalPath?: string) {
  if (!canonicalPath) return "";
  try {
    return new URL(canonicalPath, window.location.origin).href;
  } catch {
    return "";
  }
}

function setMetaContent(selector: string, content?: string) {
  const element = document.querySelector(selector);
  if (!element || !content) return null;
  const previous = element.getAttribute("content");
  element.setAttribute("content", content);
  return () => {
    if (previous === null) {
      element.removeAttribute("content");
    } else {
      element.setAttribute("content", previous);
    }
  };
}

export function setRouteMeta({
  title,
  description,
  canonicalPath,
  bodyClass,
  bodyClasses,
  cleanupBodyClasses,
}: RouteMeta = {}) {
  const classNames = [...normalizeClassList(bodyClass), ...normalizeClassList(bodyClasses)];
  const cleanupClassNames = [...new Set([...classNames, ...normalizeClassList(cleanupBodyClasses)])];
  const previousTitle = document.title;
  const restoreDescription = setMetaContent('meta[name="description"]', description);
  const canonicalHref = resolveCanonicalHref(canonicalPath);
  let canonicalLink = document.querySelector('link[rel="canonical"]');
  let createdCanonicalLink = false;
  let previousCanonicalHref = null;

  if (title) document.title = title;
  if (classNames.length) {
    document.documentElement.classList.add(...classNames);
    document.body.classList.add(...classNames);
  }

  if (canonicalHref) {
    if (!canonicalLink) {
      canonicalLink = document.createElement("link");
      canonicalLink.setAttribute("rel", "canonical");
      document.head.append(canonicalLink);
      createdCanonicalLink = true;
    } else {
      previousCanonicalHref = canonicalLink.getAttribute("href");
    }
    canonicalLink.setAttribute("href", canonicalHref);
  }

  return function restoreRouteMeta() {
    if (cleanupClassNames.length) {
      document.documentElement.classList.remove(...cleanupClassNames);
      document.body.classList.remove(...cleanupClassNames);
    }
    if (title) document.title = previousTitle;
    restoreDescription?.();

    if (!canonicalHref || !canonicalLink) return;
    if (createdCanonicalLink) {
      canonicalLink.remove();
    } else if (previousCanonicalHref === null) {
      canonicalLink.removeAttribute("href");
    } else {
      canonicalLink.setAttribute("href", previousCanonicalHref);
    }
  };
}

function getTemplate(pageName?: string, template?: string) {
  const cacheKey = `${pageName || "route"}:${String(template || "")}`;
  if (templateCache.has(cacheKey)) return templateCache.get(cacheKey);

  const templateElement = document.createElement("template");
  templateElement.innerHTML = String(template || "").trim();
  templateCache.set(cacheKey, templateElement);
  return templateElement;
}

function createNoopMountedView(): MountedView {
  return {
    unmount() {},
  };
}

export function createRouteView({
  pageName,
  template,
  meta,
  loadModule,
  mountController,
  unmountController,
}: RouteViewConfig) {
  let modulePromise: Promise<unknown> | null = null;

  return {
    async mount(root: HTMLElement, context: RouteViewRuntimeContext = {}): Promise<MountedView> {
      const signal = context.routeSignal;
      if (signal?.aborted) return createNoopMountedView();

      const cleanup = createCleanupStack();
      let routeModule: unknown = null;
      let controllerResult: MountedView | null = null;
      let routeNodes: ChildNode[] = [];
      const mountContext = {
        root,
        context,
        cleanup,
        signal,
        pageName,
      };

      const previousRouteScope = root.getAttribute("data-vb-route");
      if (pageName) root.setAttribute("data-vb-route", pageName);
      cleanup.add(() => {
        if (!pageName || root.getAttribute("data-vb-route") !== pageName) return;
        if (previousRouteScope === null) root.removeAttribute("data-vb-route");
        else root.setAttribute("data-vb-route", previousRouteScope);
      });

      function getOwnedRouteNodes() {
        return routeNodes.filter((node) =>
          node.parentNode === root
        );
      }

      function cleanupRouteDom() {
        const ownedNodes = getOwnedRouteNodes();
        if (!ownedNodes.length) return;

        for (const node of ownedNodes) {
          node.remove();
        }
      }

      cleanup.add(cleanupRouteDom);
      cleanup.add(setRouteMeta(meta));
      const templateElement = getTemplate(pageName, template);
      root.replaceChildren(templateElement.content.cloneNode(true));
      routeNodes = Array.from(root.childNodes);
      const focusedWorkspaces = initFocusedWorkspaces(root);
      cleanup.add(() => focusedWorkspaces.destroy());
      if (signal?.addEventListener) {
        const handleAbort = () => {
          cleanup.run();
        };
        signal.addEventListener("abort", handleAbort, { once: true });
        cleanup.add(() => {
          signal.removeEventListener("abort", handleAbort);
        });
      }

      try {
        if (!modulePromise) {
          modulePromise = Promise.resolve().then(loadModule);
        }

        routeModule = await modulePromise;

        if (signal?.aborted) {
          cleanup.run();
          return createNoopMountedView();
        }

        controllerResult = ((await mountController?.(routeModule, mountContext)) || null) as MountedView | null;
        cleanup.add(() => {
          unmountController?.(routeModule, mountContext);
        });
        cleanup.add(() => {
          controllerResult?.unmount?.();
        });

        if (signal?.aborted) {
          cleanup.run();
          return createNoopMountedView();
        }

        window.dispatchEvent(new Event("resize"));
      } catch (error) {
        if (!routeModule) modulePromise = null;
        if (routeModule) {
          try {
            unmountController?.(routeModule, mountContext);
          } catch {
            // The cleanup stack below still owns route DOM and metadata cleanup.
          }
        }
        cleanup.run();
        throw error;
      }

      let disposed = false;
      return {
        unmount() {
          if (disposed) return;
          disposed = true;
          cleanup.run();
        },
      };
    },
  };
}
