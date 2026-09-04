export const FOCUSED_VIEW_CHANGE_EVENT = "vb:focused-view-change";

type FocusedViewChangeDetail = {
  activeView: string;
  focused: boolean;
};

function isNarrowPortraitViewport() {
  const viewport = globalThis.visualViewport;
  const width = Number(viewport?.width) || globalThis.innerWidth || 0;
  const layoutPortrait = globalThis.matchMedia?.("(orientation: portrait)").matches
    ?? ((globalThis.innerHeight || 0) >= (globalThis.innerWidth || 0));
  return layoutPortrait && width <= 600;
}

function setInert(element: HTMLElement, inert: boolean) {
  element.inert = inert;
  if (inert) element.setAttribute("inert", "");
  else element.removeAttribute("inert");
}

function readPersistedView(key: string) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function persistView(key: string, view: string) {
  try {
    localStorage.setItem(key, view);
  } catch {
    // Focused-view recovery is a convenience when storage is unavailable.
  }
}

export function initFocusedWorkspaces(root: ParentNode = document) {
  const workspaces = Array.from(
    root.querySelectorAll<HTMLElement>("[data-vb-focused-workspace]"),
  );
  if (!workspaces.length) return { destroy() {} };

  const removers: Array<() => void> = [];
  let stopped = false;
  let scheduled = false;

  const routeScope = root instanceof Element ? root.getAttribute("data-vb-route") || "route" : "route";
  const records = workspaces.map((workspace, workspaceIndex) => {
    const buttons = Array.from(
      workspace.querySelectorAll<HTMLButtonElement>("[data-vb-focused-view-target]"),
    );
    const panels = Array.from(
      workspace.querySelectorAll<HTMLElement>("[data-vb-focused-view-panel]"),
    );
    const defaultView = workspace.dataset.vbFocusedDefault
      || buttons[0]?.dataset.vbFocusedViewTarget
      || panels[0]?.dataset.vbFocusedViewPanel
      || "";
    const persistenceKey = `vatioboard.focused-view.v1:${workspace.dataset.vbFocusedPersistKey || `${routeScope}:${workspaceIndex}`}`;
    const persistedView = readPersistedView(persistenceKey);
    let activeView = workspace.dataset.vbFocusedActive
      || (panels.some((panel) => panel.dataset.vbFocusedViewPanel === persistedView) ? persistedView : "")
      || defaultView;

    const apply = (focused = isNarrowPortraitViewport(), emit = true) => {
      workspace.dataset.vbFocusedMode = focused ? "true" : "false";
      workspace.dataset.vbFocusedActive = activeView;

      for (const button of buttons) {
        const selected = button.dataset.vbFocusedViewTarget === activeView;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
      }

      for (const panel of panels) {
        const selected = panel.dataset.vbFocusedViewPanel === activeView;
        panel.hidden = focused && !selected;
        setInert(panel, focused && !selected);
      }

      if (!emit) return;
      workspace.dispatchEvent(new CustomEvent<FocusedViewChangeDetail>(FOCUSED_VIEW_CHANGE_EVENT, {
        bubbles: true,
        detail: { activeView, focused },
      }));
    };

    const select = (view: string, { focus = false } = {}) => {
      if (!view || !panels.some((panel) => panel.dataset.vbFocusedViewPanel === view)) return;
      activeView = view;
      persistView(persistenceKey, activeView);
      apply(isNarrowPortraitViewport());
      if (focus) buttons.find((button) => button.dataset.vbFocusedViewTarget === view)?.focus();
    };

    for (const [index, button] of buttons.entries()) {
      const click = () => select(button.dataset.vbFocusedViewTarget || "");
      const keydown = (event: KeyboardEvent) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        select(buttons[nextIndex]?.dataset.vbFocusedViewTarget || "", { focus: true });
      };
      button.addEventListener("click", click);
      button.addEventListener("keydown", keydown);
      removers.push(() => {
        button.removeEventListener("click", click);
        button.removeEventListener("keydown", keydown);
      });
    }

    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || activeView === defaultView || !isNarrowPortraitViewport()) return;
      event.preventDefault();
      select(defaultView, { focus: true });
    };
    workspace.addEventListener("keydown", escape);
    removers.push(() => workspace.removeEventListener("keydown", escape));
    apply(isNarrowPortraitViewport(), false);
    return { apply, panels };
  });

  const schedule = () => {
    if (stopped || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (stopped) return;
      const focused = isNarrowPortraitViewport();
      for (const record of records) record.apply(focused);
    });
  };

  globalThis.addEventListener?.("resize", schedule);
  globalThis.addEventListener?.("orientationchange", schedule);
  globalThis.visualViewport?.addEventListener?.("resize", schedule);

  return {
    destroy() {
      stopped = true;
      globalThis.removeEventListener?.("resize", schedule);
      globalThis.removeEventListener?.("orientationchange", schedule);
      globalThis.visualViewport?.removeEventListener?.("resize", schedule);
      for (const remove of removers.splice(0)) remove();
      for (const record of records) {
        for (const panel of record.panels) {
          panel.hidden = false;
          setInert(panel, false);
        }
      }
    },
  };
}
