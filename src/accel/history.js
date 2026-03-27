export function createAccelHistoryHelpers({ getRuns, formatRunSeconds, t, buildComparisonSignature }) {
  function findBestComparableRun(result) {
    const runs = getRuns();
    const matches = [];
    const validMatches = [];
    const comparisonSignature = result && result.comparisonSignature
      ? result.comparisonSignature
      : buildComparisonSignature(result);

    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      const runComparisonSignature = run.comparisonSignature || buildComparisonSignature(run);
      if (runComparisonSignature !== comparisonSignature) continue;
      matches.push(run);
      if (run.qualityGrade !== "invalid") validMatches.push(run);
    }

    const comparableRuns = validMatches.length ? validMatches : matches;
    if (!comparableRuns.length) return null;

    comparableRuns.sort((left, right) => left.elapsedMs - right.elapsedMs);
    return comparableRuns[0];
  }

  function buildComparisonText(result) {
    const best = findBestComparableRun(result);
    if (!best) return t("accelNoComparison");
    if (best.id === result.id) return t("accelBestRun");

    const deltaMs = result.elapsedMs - best.elapsedMs;
    const deltaText = `${formatRunSeconds(Math.abs(deltaMs))} s`;
    return deltaMs < 0 ? t("accelFasterBy", { value: deltaText }) : t("accelSlowerBy", { value: deltaText });
  }

  return {
    findBestComparableRun,
    buildComparisonText,
  };
}
