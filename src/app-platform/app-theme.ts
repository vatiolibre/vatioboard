import type { VatioAppManifest, VatioAppTheme } from "./types";

export const DEFAULT_APP_THEME: Required<VatioAppTheme> = {
  color: "#10b981",
  color2: "#34d399",
  foreground: "#ffffff",
};

function cleanColor(value: unknown, fallback: string) {
  const color = typeof value === "string" ? value.trim() : "";
  return color || fallback;
}

export function getAppTheme(app: Pick<VatioAppManifest, "theme"> | null | undefined): Required<VatioAppTheme> {
  const theme: Partial<VatioAppTheme> = app?.theme || {};
  const color = cleanColor(theme.color, DEFAULT_APP_THEME.color);
  return {
    color,
    color2: cleanColor(theme.color2, color),
    foreground: cleanColor(theme.foreground, DEFAULT_APP_THEME.foreground),
  };
}

export function applyAppIconTheme(
  element: HTMLElement | null | undefined,
  app: Pick<VatioAppManifest, "id" | "theme"> | null | undefined,
) {
  if (!element) return;
  const theme = getAppTheme(app);
  element.style.setProperty("--vb-app-icon-accent", theme.color);
  element.style.setProperty("--vb-app-icon-accent-2", theme.color2);
  element.style.setProperty("--vb-app-icon-foreground", theme.foreground);
  if (app?.id) element.dataset.vbAppTheme = app.id;
}
