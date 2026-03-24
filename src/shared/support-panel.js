export function initSupportPanel(options) {
  var buttonId = options && options.buttonId ? options.buttonId : "supportPanelTrigger";
  var panelId = options && options.panelId ? options.panelId : "supportPanel";
  var closeId = options && options.closeId ? options.closeId : "supportPanelClose";

  var button = document.getElementById(buttonId);
  var panel = document.getElementById(panelId);
  var closeButton = document.getElementById(closeId);

  if (!button || !panel) {
    return {
      close: function () {},
      setOpen: function () {},
    };
  }

  function setOpen(isOpen) {
    panel.hidden = !isOpen;
    button.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  function close() {
    setOpen(false);
  }

  button.addEventListener("click", function (event) {
    event.stopPropagation();
    setOpen(panel.hidden);
  });

  closeButton?.addEventListener("click", function () {
    close();
  });

  document.addEventListener("click", function (event) {
    if (panel.hidden) return;
    if (button.contains(event.target) || panel.contains(event.target)) return;
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
