const toolsMenuOpenCounts = new WeakMap();

function updateToolsMenuLayer(root, delta) {
  if (!root || !delta) return;

  const current = toolsMenuOpenCounts.get(root) || 0;
  const next = Math.max(0, current + delta);

  if (next === 0) {
    toolsMenuOpenCounts.delete(root);
    root.classList.remove("tools-menu-layer-open");
    return;
  }

  toolsMenuOpenCounts.set(root, next);
  root.classList.add("tools-menu-layer-open");
}

export function applyButtonIcon(button, icon) {
  var iconSlot = button && button.querySelector ? button.querySelector(".btn-icon") : null;
  if (!iconSlot) return;
  iconSlot.innerHTML = icon || "";
}

export function initToolsMenu(options) {
  var button = options && options.button ? options.button : null;
  var list = options && options.list ? options.list : null;

  if (!button || !list) {
    return {
      close: function () {},
      setOpen: function () {},
    };
  }

  var stackingRoot = button.closest("header") || list.closest("header");
  var open = list.hidden === false;

  if (open) updateToolsMenuLayer(stackingRoot, 1);

  function setOpen(isOpen) {
    var nextOpen = isOpen === true;
    list.hidden = !nextOpen;
    button.setAttribute("aria-expanded", nextOpen ? "true" : "false");

    if (nextOpen === open) return;

    updateToolsMenuLayer(stackingRoot, nextOpen ? 1 : -1);
    open = nextOpen;
  }

  function close() {
    setOpen(false);
  }

  button.addEventListener("click", function (event) {
    event.stopPropagation();
    setOpen(list.hidden);
  });

  document.addEventListener("click", function (event) {
    if (list.hidden) return;
    if (button.contains(event.target) || list.contains(event.target)) return;
    close();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") close();
  });

  return {
    close: close,
    setOpen: setOpen,
  };
}
