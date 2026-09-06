export function createGpsTracePlayer({ emit, now = () => Date.now() }) {
  return {
    play(trace) {
      const startedAtMs = now();
      return (trace?.samples || []).map((sample) => {
        const timestamp = startedAtMs + Math.max(0, Number(sample.offsetMs) || 0);
        const position = { timestamp, coords: { ...sample.coords } };
        emit(position);
        return position;
      });
    },
  };
}
