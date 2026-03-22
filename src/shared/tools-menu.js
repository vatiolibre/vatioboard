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

  function setOpen(isOpen) {
    list.hidden = !isOpen;
    button.setAttribute("aria-expanded", isOpen ? "true" : "false");
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
