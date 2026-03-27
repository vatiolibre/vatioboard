export function getBrowserMocks() {
  return globalThis.__browserMocks;
}

export function createGeolocationPosition(overrides = {}) {
  const coords = {
    latitude: 40.7128,
    longitude: -74.006,
    accuracy: 5,
    altitude: 12,
    altitudeAccuracy: 3,
    heading: 180,
    speed: 0,
    ...(overrides.coords ?? {}),
  };

  return {
    coords,
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

export function emitGeolocationSuccess(overrides = {}) {
  getBrowserMocks().geolocation.emitSuccess(createGeolocationPosition(overrides));
}

export function emitGeolocationError(overrides = {}) {
  getBrowserMocks().geolocation.emitError({
    code: overrides.code ?? 1,
    message: overrides.message ?? "Mock geolocation error",
  });
}
