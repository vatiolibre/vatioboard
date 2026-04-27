import { createCleanupStack } from "../view-cleanup.js";

const templateCache = new Map();

function normalizeClassList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value).split(/\s+/).filter(Boolean);
}

function resolveCanonicalHref(canonicalPath) {
  if (!canonicalPath) return "";
  try {
    return new URL(canonicalPath, window.location.origin).href;
  } catch {
    return "";
  }
}

function setMetaContent(selector, content) {
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
} = {}) {
  const classNames = [...normalizeClassList(bodyClass), ...normalizeClassList(bodyClasses)];
  const cleanupClassNames = [...new Set([...classNames, ...normalizeClassList(cleanupBodyClasses)])];
  const previousTitle = document.title;
  const restoreDescription = setMetaContent('meta[name="description"]', description);
  const canonicalHref = resolveCanonicalHref(canonicalPath);
  let canonicalLink = document.querySelector('link[rel="canonical"]');
  let createdCanonicalLink = false;
  let previousCanonicalHref = null;

  if (title) document.title = title;
  if (classNames.length) document.body.classList.add(...classNames);

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
    if (cleanupClassNames.length) document.body.classList.remove(...cleanupClassNames);
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

function getTemplate(pageName, template) {
  const cacheKey = `${pageName || "route"}:${String(template || "")}`;
  if (templateCache.has(cacheKey)) return templateCache.get(cacheKey);

  const templateElement = document.createElement("template");
  templateElement.innerHTML = String(template || "").trim();
  templateCache.set(cacheKey, templateElement);
  return templateElement;
}

function createNoopMountedView() {
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
  preserveDom = false,
}) {
  let modulePromise = null;
  let preservedDom = null;

  return {
    async mount(root, context = {}) {
      const signal = context.routeSignal;
      if (signal?.aborted) return createNoopMountedView();

      const cleanup = createCleanupStack();
      let routeModule = null;
      let controllerResult = null;
      let routeNodes = [];
      const mountContext = {
        root,
        context,
        cleanup,
        signal,
        pageName,
      };

      function cleanupRouteDom() {
        const ownedNodes = routeNodes.filter((node) => node.parentNode === root);
        if (!ownedNodes.length) return;

        if (preserveDom) {
          preservedDom = document.createDocumentFragment();
          for (const node of ownedNodes) {
            preservedDom.append(node);
          }
          return;
        }

        for (const node of ownedNodes) {
          node.remove();
        }
      }

      cleanup.add(cleanupRouteDom);
      cleanup.add(setRouteMeta(meta));
      const templateElement = getTemplate(pageName, template);
      const nextRouteDom =
        preserveDom && preservedDom ? preservedDom : templateElement.content.cloneNode(true);
      root.replaceChildren(nextRouteDom);
      preservedDom = null;
      routeNodes = Array.from(root.childNodes);

      try {
        if (!modulePromise) {
          modulePromise = Promise.resolve().then(loadModule);
        }

        routeModule = await modulePromise;

        if (signal?.aborted) {
          cleanup.run();
          return createNoopMountedView();
        }

        controllerResult = await mountController?.(routeModule, mountContext);
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
