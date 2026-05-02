export function mount(root, context) {
  document.body.classList.add("player-demo-page");
  document.title = "VatioBoard Audio Player";

  const view = document.createElement("div");
  view.className = "player-demo";
  view.innerHTML = `
    <h1>Audio Player</h1>
    <p>Persistent audio player widget. Queue and playback continue while you move between routes.</p>
    <button id="openPlayer" class="player-demo-btn" type="button">Open Player</button>
  `;

  view.querySelector("#openPlayer")?.addEventListener("click", () => {
    context.audioRuntime.primeAudio?.();
    window.__vatioboardPlayerWidget?.open?.();
  });

  root.replaceChildren(view);

  return {
    unmount() {
      document.body.classList.remove("player-demo-page");
      root.replaceChildren();
    },
  };
}
