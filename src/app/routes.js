export const routes = [
  {
    path: "/",
    aliases: ["/speed"],
    title: "Vatio Speed",
    load: () => import("./views/SpeedView.js"),
  },
  {
    path: "/library",
    title: "Cloud Library",
    load: () => import("./views/LibraryView.js"),
  },
  {
    path: "/accel",
    title: "Vatio Accel",
    load: () => import("./views/AccelView.js"),
  },
  {
    path: "/replay",
    title: "Drive Replay",
    load: () => import("./views/ReplayView.js"),
  },
  {
    path: "/board",
    title: "Vatio Board",
    load: () => import("./views/BoardView.js"),
  },
];
