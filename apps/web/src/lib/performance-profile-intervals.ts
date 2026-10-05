export type ProfileInterval = { start: number; end: number };

export type ProfileCoverage = {
  observedStart: number | null;
  observedEnd: number | null;
  uncoveredPrefix: number;
  uncoveredSuffix: number;
  unionCoverage: number;
};

export function clipProfileIntervals(
  intervals: readonly ProfileInterval[],
  start: number,
  end: number,
): ProfileInterval[] {
  return intervals.flatMap((interval) => {
    const clippedStart = Math.max(interval.start, start);
    const clippedEnd = Math.min(interval.end, end);
    return clippedEnd > clippedStart
      ? [{ start: clippedStart, end: clippedEnd }]
      : [];
  });
}

export function summarizeProfileCoverage(
  intervals: readonly ProfileInterval[],
  start: number,
  end: number,
): ProfileCoverage {
  const observed = clipProfileIntervals(intervals, start, end).sort(
    (left, right) => left.start - right.start,
  );
  const union = observed.reduce<ProfileInterval[]>((merged, next) => {
    const previous = merged.at(-1);
    if (previous && next.start <= previous.end) {
      previous.end = Math.max(previous.end, next.end);
    } else {
      merged.push({ ...next });
    }
    return merged;
  }, []);
  const observedStart = union[0]?.start ?? null;
  const observedEnd = union.at(-1)?.end ?? null;

  return {
    observedStart,
    observedEnd,
    uncoveredPrefix:
      observedStart === null ? end - start : observedStart - start,
    uncoveredSuffix: observedEnd === null ? end - start : end - observedEnd,
    unionCoverage: union.reduce(
      (total, interval) => total + interval.end - interval.start,
      0,
    ),
  };
}
