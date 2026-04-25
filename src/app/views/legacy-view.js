const templateCache = new Map();

function parseLegacyHtml(html) {
  if (templateCache.has(html)) return templateCache.get(html);

  const parser = new DOMParser();
  const documentFragment = parser.parseFromString(String(html || ""), "text/html");
  for (const script of documentFragment.body.querySelectorAll("script")) {
    script.remove();
  }

  const parsed = {
    title: documentFragment.querySelector("title")?.textContent || "",
    description:
      documentFragment.querySelector('meta[name="description"]')?.getAttribute("content") || "",
    htmlClasses: Array.from(documentFragment.documentElement.classList),
    bodyClasses: Array.from(documentFragment.body.classList),
    bodyHtml: documentFragment.body.innerHTML,
  };

  templateCache.set(html, parsed);
  return parsed;
}

export function createLegacyView({ html, loadModule, pageName }) {
  let host = null;
  let modulePromise = null;
  let loadedModule = null;
  let mounted = false;
  const parsed = parseLegacyHtml(html);

  function ensureHost() {
    if (host) return host;
    host = document.createElement("div");
    host.className = `app-legacy-view app-legacy-view-${pageName}`;
    host.dataset.appLegacyView = pageName;
    host.innerHTML = parsed.bodyHtml;
    return host;
  }

  function applyDocumentState() {
    if (parsed.title) document.title = parsed.title;

    const descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta && parsed.description) {
      descriptionMeta.setAttribute("content", parsed.description);
    }

    document.documentElement.classList.add(...parsed.htmlClasses);
    document.body.classList.add(...parsed.bodyClasses);
  }

  function clearDocumentState() {
    document.documentElement.classList.remove(...parsed.htmlClasses);
    document.body.classList.remove(...parsed.bodyClasses);
  }

  return {
    async mount(root, context) {
      mounted = true;
      const viewHost = ensureHost();
      root.replaceChildren(viewHost);
      applyDocumentState();

      if (!modulePromise) {
        modulePromise = Promise.resolve().then(loadModule).then((module) => {
          loadedModule = module;
          return module;
        });
      }

      const legacyModule = await modulePromise;

      if (mounted) {
        legacyModule?.onLegacyViewMount?.({ host: viewHost, context, pageName });
        context?.emitRouteVisible?.();
        window.dispatchEvent(new Event("resize"));
      } else {
        legacyModule?.onLegacyViewUnmount?.({ host: viewHost, context, pageName });
      }

      return {
        unmount() {
          mounted = false;
          loadedModule?.onLegacyViewUnmount?.({ host: viewHost, context, pageName });
          clearDocumentState();
          root.replaceChildren();
        },
      };
    },
  };
}
