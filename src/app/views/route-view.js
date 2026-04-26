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

export function createRouteView({
  pageName,
  template,
  meta,
  loadModule,
  mountController,
  unmountController,
}) {
  let routeNodes = null;
  let modulePromise = null;
  let loadedModule = null;
  let mounted = false;

  function ensureRouteNodes() {
    if (routeNodes) return routeNodes;
    if (templateCache.has(template)) {
      routeNodes = templateCache.get(template).map((node) => node.cloneNode(true));
      return routeNodes;
    }

    const templateElement = document.createElement("template");
    templateElement.innerHTML = String(template || "").trim();
    const cachedNodes = Array.from(templateElement.content.childNodes);
    templateCache.set(template, cachedNodes.map((node) => node.cloneNode(true)));
    routeNodes = cachedNodes;
    return routeNodes;
  }

  return {
    async mount(root, context) {
      mounted = true;
      const routeMetaCleanup = setRouteMeta(meta);
      const nodes = ensureRouteNodes();
      root.replaceChildren(...nodes);

      if (!modulePromise) {
        modulePromise = Promise.resolve().then(loadModule).then((module) => {
          loadedModule = module;
          return module;
        });
      }

      const routeModule = await modulePromise;

      if (mounted) {
        mountController?.(routeModule, { root, context, pageName });
        window.dispatchEvent(new Event("resize"));
      } else {
        unmountController?.(routeModule, { root, context, pageName });
      }

      let disposed = false;
      return {
        unmount() {
          if (disposed) return;
          disposed = true;
          mounted = false;
          unmountController?.(loadedModule, { root, context, pageName });
          routeMetaCleanup();
          root.replaceChildren();
        },
      };
    },
  };
}
