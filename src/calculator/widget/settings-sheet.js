function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function initSettingsSheet({
  panel,
  settings,
  settingsBtn,
  settingsSheet,
  settingsCloseBtn,
  settingsDecimalsMinus,
  settingsDecimalsPlus,
  settingsDecimalsValue,
  settingsThousandsToggle,
  saveSettings,
  onChange,
  onOpen,
}) {
  const setSettingsSheetOpen = (isOpen) => {
    if (isOpen) {
      settingsSheet.hidden = false;
      settingsSheet.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => settingsSheet.classList.add("is-open"));
      onOpen?.();
      return;
    }

    settingsSheet.classList.remove("is-open");
    settingsSheet.setAttribute("aria-hidden", "true");
  };

  settingsSheet.addEventListener("transitionend", (e) => {
    if (e.propertyName !== "transform") return;
    if (!settingsSheet.classList.contains("is-open")) {
      settingsSheet.hidden = true;
    }
  });

  function syncForm() {
    settingsDecimalsValue.textContent = String(settings.decimals ?? "");
    settingsThousandsToggle.checked = (settings.thousandSeparator ?? "") !== "";
  }

  function updateSettings(partial) {
    Object.assign(settings, partial);
    saveSettings(settings);
    onChange?.(settings);
  }

  settingsBtn.addEventListener("click", () => {
    const isOpen = settingsSheet.classList.contains("is-open");
    if (!isOpen) syncForm();
    setSettingsSheetOpen(!isOpen);
  });

  settingsCloseBtn.addEventListener("click", () => {
    setSettingsSheetOpen(false);
  });

  settingsDecimalsMinus.addEventListener("click", () => {
    const next = clampInt((settings.decimals ?? 0) - 1, 0, 10);
    updateSettings({ decimals: next });
    syncForm();
  });

  settingsDecimalsPlus.addEventListener("click", () => {
    const next = clampInt((settings.decimals ?? 0) + 1, 0, 10);
    updateSettings({ decimals: next });
    syncForm();
  });

  settingsThousandsToggle.addEventListener("change", () => {
    updateSettings({ thousandSeparator: settingsThousandsToggle.checked ? "." : "" });
  });

  panel.addEventListener("click", (e) => {
    if (!settingsSheet.classList.contains("is-open")) return;
    if (!settingsSheet.contains(e.target) && !settingsBtn.contains(e.target)) {
      setSettingsSheetOpen(false);
    }
  });

  syncForm();

  return { setSettingsSheetOpen };
}
