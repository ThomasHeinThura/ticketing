export type TraceProfileClock = {
  profileStartTimestamp: number;
  nextSampleTimestamp: number;
};

export type TimedTraceSample = {
  nodeId: number;
  start: number;
  duration: number;
};

export function traceProfileKey(
  pid: number,
  tid: number,
  source: string,
  id: string,
) {
  return `${pid}:${tid}:${source}:${id}`;
}

export function anchorTraceProfile(
  clocks: Map<string, TraceProfileClock>,
  key: string,
  profileStartTimestamp: number,
): boolean {
  if (!Number.isFinite(profileStartTimestamp)) return false;
  const current = clocks.get(key);
  if (current) return current.profileStartTimestamp === profileStartTimestamp;
  clocks.set(key, {
    profileStartTimestamp,
    nextSampleTimestamp: profileStartTimestamp,
  });
  return true;
}

/**
 * V8 ProfileChunk deltas continue from the initial Profile event across chunk
 * boundaries. Chunk emission timestamps are deliberately not used as anchors.
 */
export function timeTraceProfileChunk(
  clock: TraceProfileClock | undefined,
  sampleIds: readonly number[],
  timeDeltas: readonly number[],
): TimedTraceSample[] | undefined {
  if (!clock || sampleIds.length !== timeDeltas.length) return undefined;
  if (
    sampleIds.some((id) => !Number.isSafeInteger(id) || id < 0) ||
    timeDeltas.some((delta) => !Number.isFinite(delta) || delta < 0)
  )
    return undefined;

  let next = clock.nextSampleTimestamp;
  const samples: TimedTraceSample[] = [];
  for (let index = 0; index < sampleIds.length; index += 1) {
    const duration = timeDeltas[index];
    if (duration === undefined || !Number.isFinite(next + duration))
      return undefined;
    samples.push({ nodeId: sampleIds[index], start: next, duration });
    next += duration;
  }
  clock.nextSampleTimestamp = next;
  return samples;
}
