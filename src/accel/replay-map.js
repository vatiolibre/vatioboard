import { isFiniteNumber } from "./logic.js";
import {
  buildAccelReplayMapSession,
  getAccelReplayPlayedCoordinates,
} from "./replay.js";
import { createReplayMapController } from "../replay/map.js";

function hasGeoPoint(frame) {
  return isFiniteNumber(frame?.latitude) && isFiniteNumber(frame?.longitude);
}

export function createAccelReplayMapController({ element }) {
  const baseController = createReplayMapController({
    element,
    session: null,
  });

  let activeSource = null;

  function setSource(source) {
    if (source === activeSource) return;
    activeSource = source || null;
    baseController.setSession(buildAccelReplayMapSession(activeSource));
  }

  function renderPlaybackFrame(source, playbackFrame, elapsedMs) {
    if (!activeSource || !source) {
      baseController.renderPlaybackFrame({
        sample: null,
        playedCoordinates: [],
      });
      return;
    }

    baseController.renderPlaybackFrame({
      sample: hasGeoPoint(playbackFrame) ? playbackFrame : null,
      playedCoordinates: getAccelReplayPlayedCoordinates(source, elapsedMs),
    });
  }

  function clear() {
    activeSource = null;
    baseController.setSession(null);
    baseController.renderPlaybackFrame({
      sample: null,
      playedCoordinates: [],
    });
  }

  function destroy() {
    activeSource = null;
    baseController.destroy();
  }

  return {
    clear,
    destroy,
    fitRoute: baseController.fitRoute,
    init: baseController.init,
    renderPlaybackFrame,
    resetCamera: baseController.resetCamera,
    runApproachAnimation: baseController.runApproachAnimation,
    setSource,
  };
}
