export interface ShellZIndexLayers {
  windowBase: number;
  windowMax: number;
  taskbar: number;
  activity: number;
  startMenu: number;
  fullscreen: number;
  modal: number;
}

export const SHELL_Z_INDEX: Readonly<ShellZIndexLayers> = Object.freeze({
  windowBase: 1000,
  windowMax: 1890,
  taskbar: 1950,
  activity: 1955,
  startMenu: 1960,
  fullscreen: 1980,
  modal: 2000,
});
