import { isFiniteNumber } from "./logic.js";
import {
  buildAccelReplayMapSession,
  getAccelReplayPlayedCoordinates,
} from "./replay.js";
import { createReplayMapController } from "../replay/map.js";

function hasGeoPoint(frame) {
  return isFiniteNumber(frame?.latitude) && isFiniteNumber(frame?.longitude);
}

const ACCEL_APPROACH_OPTIONS = {
  finalMaxZoom: 16.8,
  finalPitch: 58,
  finalBearing: 10,
  finalPadding: { top: 48, right: 48, bottom: 72, left: 48 },
};

export function createAccelReplayMapController({ element }) {
  const baseController = createReplayMapController({
    element,
    session: null,
  });

  let activeSource = null;

  function setSource(source, options = {}) {
    if (source === activeSource && !options.forceUpdate) return;
    activeSource = source || null;
    baseController.setSession(buildAccelReplayMapSession(activeSource), options);
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

  function runApproachAnimation() {
    return baseController.runApproachAnimation(ACCEL_APPROACH_OPTIONS);
  }

  return {
    cancelApproachAnimation: baseController.cancelApproachAnimation,
    clear,
    destroy,
    fitRoute: baseController.fitRoute,
    init: baseController.init,
    renderPlaybackFrame,
    resetCamera: baseController.resetCamera,
    runApproachAnimation,
    setSource,
  };
}
