const VISIBILITY_KEY = "milkdrop_panel_visible_v1";

export function loadMilkdropPanelVisibility() {
  try {
    return localStorage.getItem(VISIBILITY_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveMilkdropPanelVisibility(isOpen) {
  try {
    localStorage.setItem(VISIBILITY_KEY, isOpen ? "true" : "false");
  } catch {
    // Ignore storage failures; visibility persistence is a convenience.
  }
}
