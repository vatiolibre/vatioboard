import { getShellWorkArea, getViewportRect } from "./shell-work-area.js";
import type { ShellLayoutMetrics, ShellViewportProfile } from "../types/shell";

type LayoutMetricsOptions = {
  root?: Document | Element | null;
  safeMargin?: number;
  viewport?: Record<string, unknown>;
  orientation?: "landscape" | "portrait";
};

const safeAreaCache = new WeakMap<Document, {
  signature: string;
  insets: { top: number; right: number; bottom: number; left: number };
}>();

function getDocument(root?: Document | Element | null) {
  if (typeof Document !== "undefined" && root instanceof Document) return root;
  return root?.ownerDocument || globalThis.document || null;
}

function readSafeAreaInsets(doc: Document | null) {
  if (!doc?.body || typeof getComputedStyle !== "function") {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const visualViewport = globalThis.visualViewport;
  const signature = [
    globalThis.innerWidth,
    globalThis.innerHeight,
    visualViewport?.width,
    visualViewport?.height,
    visualViewport?.offsetLeft,
    visualViewport?.offsetTop,
    globalThis.matchMedia?.("(orientation: portrait)").matches,
  ].join(":");
  const cached = safeAreaCache.get(doc);
  if (cached?.signature === signature) return cached.insets;
  const probe = doc.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = [
    "position:fixed",
    "visibility:hidden",
    "pointer-events:none",
    "padding-top:env(safe-area-inset-top)",
    "padding-right:env(safe-area-inset-right)",
    "padding-bottom:env(safe-area-inset-bottom)",
    "padding-left:env(safe-area-inset-left)",
  ].join(";");
  doc.body.append(probe);
  const style = getComputedStyle(probe);
  const number = (value: string) => Number.parseFloat(value) || 0;
  const insets = {
    top: number(style.paddingTop),
    right: number(style.paddingRight),
    bottom: number(style.paddingBottom),
    left: number(style.paddingLeft),
  };
  probe.remove();
  safeAreaCache.set(doc, { signature, insets });
  return insets;
}

export function getShellViewportProfile(
  width: number,
  height: number,
  orientation?: "landscape" | "portrait",
): ShellViewportProfile {
  const resolvedOrientation = orientation || (height > width ? "portrait" : "landscape");
  if (resolvedOrientation === "portrait") return "portrait";
  if (height <= 760) {
    return width >= 1000 ? "wide-landscape" : "short-landscape";
  }
  return "standard";
}

export function isFocusedLandscapeProfile(profile: string | null | undefined) {
  return profile === "short-landscape" || profile === "wide-landscape";
}

export function getShellLayoutMetrics(options: LayoutMetricsOptions = {}): ShellLayoutMetrics {
  const viewport = getViewportRect(options.viewport || {});
  const safeArea = readSafeAreaInsets(getDocument(options.root));
  const safeViewport = {
    left: viewport.left + safeArea.left,
    top: viewport.top + safeArea.top,
    width: Math.max(1, viewport.width - safeArea.left - safeArea.right),
    height: Math.max(1, viewport.height - safeArea.top - safeArea.bottom),
  };
  const workArea = getShellWorkArea({
    root: options.root,
    viewport: safeViewport,
    safeMargin: options.safeMargin,
  });
  const orientation = options.orientation
    || (globalThis.matchMedia?.("(orientation: portrait)").matches
      ? "portrait"
      : globalThis.matchMedia?.("(orientation: landscape)").matches
        ? "landscape"
        : viewport.width > viewport.height ? "landscape" : "portrait");
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;

  return {
    viewport,
    workArea,
    safeArea,
    reserved: {
      top: Math.max(0, workArea.top - viewport.top),
      right: Math.max(0, viewportRight - (workArea.left + workArea.width)),
      bottom: Math.max(0, viewportBottom - (workArea.top + workArea.height)),
      left: Math.max(0, workArea.left - viewport.left),
    },
    orientation,
    profile: getShellViewportProfile(workArea.width, workArea.height, orientation),
    devicePixelRatio: Number(globalThis.devicePixelRatio) || 1,
  };
}

export function applyShellLayoutMetrics(metrics: ShellLayoutMetrics, root?: Document | Element | null) {
  const doc = getDocument(root);
  const target = doc?.documentElement;
  if (!target) return;
  const px = (value: number) => `${Math.max(0, Math.round(value * 100) / 100)}px`;
  target.dataset.vbLayoutProfile = metrics.profile;
  target.dataset.vbLayoutOrientation = metrics.orientation;
  target.style.setProperty("--vb-viewport-left", px(metrics.viewport.left || 0));
  target.style.setProperty("--vb-viewport-top", px(metrics.viewport.top || 0));
  target.style.setProperty("--vb-viewport-width", px(metrics.viewport.width));
  target.style.setProperty("--vb-viewport-height", px(metrics.viewport.height));
  target.style.setProperty("--vb-safe-area-top", px(metrics.safeArea.top));
  target.style.setProperty("--vb-safe-area-right", px(metrics.safeArea.right));
  target.style.setProperty("--vb-safe-area-bottom", px(metrics.safeArea.bottom));
  target.style.setProperty("--vb-safe-area-left", px(metrics.safeArea.left));
  target.style.setProperty("--vb-work-area-left", px(metrics.workArea.left));
  target.style.setProperty("--vb-work-area-top", px(metrics.workArea.top));
  target.style.setProperty("--vb-work-area-width", px(metrics.workArea.width));
  target.style.setProperty("--vb-work-area-height", px(metrics.workArea.height));
  target.style.setProperty("--vb-shell-reserved-top", px(metrics.reserved.top));
  target.style.setProperty("--vb-shell-reserved-right", px(metrics.reserved.right));
  target.style.setProperty("--vb-shell-reserved-bottom", px(metrics.reserved.bottom));
  target.style.setProperty("--vb-shell-reserved-left", px(metrics.reserved.left));
  target.style.setProperty("--vb-touch-target-min", "44px");
}

export function observeShellLayoutMetrics(
  callback: (metrics: ShellLayoutMetrics) => void = () => {},
  options: LayoutMetricsOptions = {},
) {
  let scheduled = false;
  let stopped = false;
  let lastSignature = "";

  const getSignature = (metrics: ShellLayoutMetrics) => [
    metrics.viewport.left,
    metrics.viewport.top,
    metrics.viewport.width,
    metrics.viewport.height,
    metrics.workArea.left,
    metrics.workArea.top,
    metrics.workArea.width,
    metrics.workArea.height,
    metrics.safeArea.top,
    metrics.safeArea.right,
    metrics.safeArea.bottom,
    metrics.safeArea.left,
    metrics.profile,
    metrics.orientation,
    metrics.devicePixelRatio,
  ].join(":");

  const publish = () => {
    scheduled = false;
    if (stopped) return;
    const metrics = getShellLayoutMetrics(options);
    const signature = getSignature(metrics);
    if (signature === lastSignature) return;
    lastSignature = signature;
    applyShellLayoutMetrics(metrics, options.root);
    callback(metrics);
  };
  const schedule = () => {
    if (stopped || scheduled) return;
    scheduled = true;
    queueMicrotask(publish);
  };
  globalThis.addEventListener?.("resize", schedule);
  globalThis.addEventListener?.("orientationchange", schedule);
  globalThis.visualViewport?.addEventListener?.("resize", schedule);
  globalThis.visualViewport?.addEventListener?.("scroll", schedule);

  publish();

  return () => {
    stopped = true;
    globalThis.removeEventListener?.("resize", schedule);
    globalThis.removeEventListener?.("orientationchange", schedule);
    globalThis.visualViewport?.removeEventListener?.("resize", schedule);
    globalThis.visualViewport?.removeEventListener?.("scroll", schedule);
  };
}
