type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface AccelHistoryComparable {
  id?: string | number | null;
  presetId?: string | null;
  presetSignature?: string | null;
  comparisonSignature?: string | null;
  variantGroup?: string | null;
  startSpeedMs?: number | null;
  targetSpeedMs?: number | null;
}

export interface AccelHistoryRun extends AccelHistoryComparable {
  elapsedMs: number;
  qualityGrade?: string | null;
  [key: string]: unknown;
}

export interface AccelHistoryDependencies {
  getRuns: () => AccelHistoryRun[];
  formatRunSeconds: (durationMs: number) => string;
  t: Translator;
  buildComparisonSignature: (presetLike: AccelHistoryComparable | null | undefined) => string;
}

export interface AccelHistoryHelpers {
  findBestComparableRun(result: AccelHistoryComparable | null | undefined): AccelHistoryRun | null;
  buildComparisonText(result: AccelHistoryRun): string;
}

export function createAccelHistoryHelpers({
  getRuns,
  formatRunSeconds,
  t,
  buildComparisonSignature,
}: AccelHistoryDependencies): AccelHistoryHelpers {
  function findBestComparableRun(result: AccelHistoryComparable | null | undefined): AccelHistoryRun | null {
    const runs = getRuns();
    const matches: AccelHistoryRun[] = [];
    const validMatches: AccelHistoryRun[] = [];
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

  function buildComparisonText(result: AccelHistoryRun): string {
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
