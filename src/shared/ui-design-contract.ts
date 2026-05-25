import type { UiDesignContract } from "../types/ui";

export const MIN_TOUCH_TARGET_PX = 44;

export const SAFE_AREA_TOKENS = [
  "--vb-safe-area-top",
  "--vb-safe-area-right",
  "--vb-safe-area-bottom",
  "--vb-safe-area-left",
] as const;

export const SHELL_TOUCH_TARGET_TOKEN = "--vb-touch-target-min";

export const uiDesignContract = {
  minTouchTargetPx: MIN_TOUCH_TARGET_PX,
  safeAreaTokens: SAFE_AREA_TOKENS,
  shellClassNames: [
    "vb-shell-taskbar",
    "tools-menu-list",
    "app-start-menu-list",
  ],
} satisfies UiDesignContract;
