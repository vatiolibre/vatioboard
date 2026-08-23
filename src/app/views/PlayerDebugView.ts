import type { MountedView, RouteContext } from "../../types/route";

interface PlayerDebugAudioRuntime {
  primeAudio?: () => unknown;
}

interface PlayerDebugWidget {
  open?: () => unknown;
}

type PlayerDebugRouteContext = Omit<Partial<RouteContext>, "audioRuntime"> & {
  audioRuntime?: PlayerDebugAudioRuntime | null;
};

function getPlayerDebugWidget(): PlayerDebugWidget | null {
  return (window.__vatioboardPlayerWidget || null) as PlayerDebugWidget | null;
}

export function mount(root: HTMLElement, context: PlayerDebugRouteContext): MountedView {
  document.body.classList.add("player-demo-page");
  document.title = "VatioLibre Audio Player";

  const view = document.createElement("div");
  view.className = "player-demo";
  view.innerHTML = `
    <h1>Audio Player</h1>
    <p>Persistent audio player widget. Queue and playback continue while you move between routes.</p>
    <button id="openPlayer" class="player-demo-btn" type="button">Open Player</button>
  `;

  view.querySelector("#openPlayer")?.addEventListener("click", () => {
    context.audioRuntime.primeAudio?.();
    getPlayerDebugWidget()?.open?.();
  });

  root.replaceChildren(view);

  return {
    unmount() {
      document.body.classList.remove("player-demo-page");
      root.replaceChildren();
    },
  };
}
