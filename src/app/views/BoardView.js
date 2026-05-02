import boardTemplate from "./templates/board-template.js";
import { createRouteView } from "./route-view.js";

const view = createRouteView({
  pageName: "board",
  template: boardTemplate,
  meta: {
    title: "Vatio Board - Free Drawing Board + Calculator",
    description:
      "Vatio Board is a fast, full-screen drawing board that works great in Tesla browsers. Draw with pen or eraser, adjust brush size, and save private drawings to VatioLibre.",
    canonicalPath: "/board",
    bodyClass: "board-page",
  },
  loadModule: () => import("../../board/board.js"),
  mountController: (module, routeContext) => module.mountBoardRoute?.(routeContext),
  unmountController: (module, routeContext) => module.unmountBoardRoute?.(routeContext),
});

export function mount(root, context) {
  return view.mount(root, context);
}
