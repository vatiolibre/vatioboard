import { startAppShell } from "./app-shell.js";

startAppShell().catch((error) => {
  console.error("[vatioboard] app shell failed to start", error);
  const root = document.getElementById("app-view");
  if (root) {
    root.innerHTML = '<p class="app-shell-error">VatioLibre Driving Tools could not start. Refresh to try again.</p>';
  }
});
