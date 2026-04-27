import libraryTemplate from "./templates/library-template.js";
import { createRouteView } from "./route-view.js";

const view = createRouteView({
  pageName: "library",
  template: libraryTemplate,
  meta: {
    title: "VatioBoard Cloud Library - Recover your saved speed, accel, board, and media data",
    description:
      "Browse your VatioBoard cloud library across devices with summary-first speed replays, accel runs, editable board documents, and private media assets.",
    canonicalPath: "/library",
    bodyClass: "library-page",
  },
  loadModule: () => import("../../library/library.js"),
  mountController: (module, routeContext) => module.mountLibraryRoute?.(routeContext),
  unmountController: (module, routeContext) => module.unmountLibraryRoute?.(routeContext),
});

export function mount(root, context) {
  return view.mount(root, context);
}
