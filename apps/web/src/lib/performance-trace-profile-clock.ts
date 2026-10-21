export type TraceProfileClock = {
  profileStartTimestamp: number;
  nextSampleTimestamp: number;
};

export type TraceSamplePoint = { nodeId: number; timestamp: number };

export type TimedTraceSample = {
  nodeId: number;
  start: number;
  duration: number;
};

export type TraceProfileAnchor = {
  ownerTid: number;
  source?: string;
  clock: TraceProfileClock;
};

export type TraceProfileState = {
  anchors: Map<string, TraceProfileAnchor>;
  invalidKeys: Set<string>;
};

export type TraceProfileEventInput = {
  name: "Profile" | "ProfileChunk";
  pid: unknown;
  tid: unknown;
  id: unknown;
  source?: unknown;
  timestamp?: unknown;
  samples?: unknown;
  timeDeltas?: unknown;
};

export type TraceProfileEventResult =
  | { status: "invalid"; key?: string }
  | { status: "anchored"; key: string; pid: number; id: string }
  | {
      status: "chunk";
      key: string;
      pid: number;
      id: string;
      ownerTid: number;
      source?: string;
      samples: TraceSamplePoint[];
    };

export function createTraceProfileState(): TraceProfileState {
  return { anchors: new Map(), invalidKeys: new Set() };
}

/** Profile/Chunk identity is process plus profile id; event TID is not identity. */
export function traceProfileKey(pid: unknown, id: unknown): string | undefined {
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 0)
    return undefined;
  if (typeof id !== "string" || id.length === 0) return undefined;
  return JSON.stringify([pid, id]);
}

function sourceValue(value: unknown): { valid: boolean; source?: string } {
  if (value === undefined) return { valid: true };
  if (typeof value !== "string" || value.length === 0) return { valid: false };
  return { valid: true, source: value };
}

function invalidate(state: TraceProfileState, key: string): void {
  state.invalidKeys.add(key);
  state.anchors.delete(key);
}

/**
 * Correlate a profile head and its chunks using Chromium's process/profile ID
 * contract. The head's TID is the sampled-thread owner; chunk event TIDs are
 * transport metadata and may differ. Invalid or ambiguous streams fail closed.
 */
export function ingestTraceProfileEvent(
  state: TraceProfileState,
  event: TraceProfileEventInput,
): TraceProfileEventResult {
  const key = traceProfileKey(event.pid, event.id);
  if (!key) return { status: "invalid" };
  const pid = event.pid as number;
  const id = event.id as string;
  if (state.invalidKeys.has(key)) return { status: "invalid", key };

  const parsedSource = sourceValue(event.source);
  if (!parsedSource.valid) {
    invalidate(state, key);
    return { status: "invalid", key };
  }

  if (event.name === "Profile") {
    if (
      typeof event.tid !== "number" ||
      !Number.isSafeInteger(event.tid) ||
      event.tid < 0 ||
      typeof event.timestamp !== "number" ||
      !Number.isFinite(event.timestamp) ||
      state.anchors.has(key)
    ) {
      invalidate(state, key);
      return { status: "invalid", key };
    }
    state.anchors.set(key, {
      ownerTid: event.tid,
      ...(parsedSource.source === undefined
        ? {}
        : { source: parsedSource.source }),
      clock: {
        profileStartTimestamp: event.timestamp,
        nextSampleTimestamp: event.timestamp,
      },
    });
    return { status: "anchored", key, pid, id };
  }

  const anchor = state.anchors.get(key);
  if (!anchor) {
    invalidate(state, key);
    return { status: "invalid", key };
  }
  if (
    anchor.source !== undefined &&
    parsedSource.source !== undefined &&
    anchor.source !== parsedSource.source
  ) {
    invalidate(state, key);
    return { status: "invalid", key };
  }
  if (anchor.source === undefined && parsedSource.source !== undefined) {
    anchor.source = parsedSource.source;
  }

  const sampleIds = event.samples === undefined ? [] : event.samples;
  const timeDeltas = event.timeDeltas === undefined ? [] : event.timeDeltas;
  if (!Array.isArray(sampleIds) || !Array.isArray(timeDeltas)) {
    invalidate(state, key);
    return { status: "invalid", key };
  }
  const timedSamples = timeTraceProfileChunk(
    anchor.clock,
    sampleIds as number[],
    timeDeltas as number[],
  );
  if (!timedSamples) {
    invalidate(state, key);
    return { status: "invalid", key };
  }

  return {
    status: "chunk",
    key,
    pid,
    id,
    ownerTid: anchor.ownerTid,
    source: anchor.source ?? parsedSource.source,
    samples: timedSamples,
  };
}

/**
 * V8 ProfileChunk deltas continue from the initial Profile event across chunk
 * boundaries. Deltas are signed differences between sample timestamps, not
 * durations. Preserve arrival order for reconstruction; sort the complete stream
 * only after capture. Chunk emission timestamps are not sample anchors.
 */
export function timeTraceProfileChunk(
  clock: TraceProfileClock | undefined,
  sampleIds: readonly number[],
  timeDeltas: readonly number[],
): TraceSamplePoint[] | undefined {
  if (!clock || sampleIds.length !== timeDeltas.length) return undefined;
  if (
    sampleIds.some((id) => !Number.isSafeInteger(id) || id < 0) ||
    timeDeltas.some((delta) => !Number.isSafeInteger(delta))
  )
    return undefined;

  let next = clock.nextSampleTimestamp;
  const samples: TraceSamplePoint[] = [];
  for (let index = 0; index < sampleIds.length; index += 1) {
    const delta = timeDeltas[index];
    const nodeId = sampleIds[index];
    if (
      delta === undefined ||
      nodeId === undefined ||
      !Number.isSafeInteger(next + delta) ||
      next + delta < 0
    )
      return undefined;
    next += delta;
    samples.push({ nodeId, timestamp: next });
  }
  clock.nextSampleTimestamp = next;
  return samples;
}

/**
 * Infer intervals only between observed samples after all chunks arrive. Later
 * chunks can contain earlier timestamps, so sorting each chunk is insufficient.
 * Do not extrapolate a tail or attribute ambiguous equal-timestamp samples.
 */
export function traceSampleIntervals(
  points: readonly TraceSamplePoint[],
): TimedTraceSample[] {
  if (
    points.some(
      ({ nodeId, timestamp }) =>
        !Number.isSafeInteger(nodeId) ||
        nodeId < 0 ||
        !Number.isSafeInteger(timestamp) ||
        timestamp < 0,
    )
  )
    return [];
  const ordered = [...points].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  const intervals: TimedTraceSample[] = [];
  for (let index = 0; index + 1 < ordered.length; index++) {
    const current = ordered[index];
    const next = ordered[index + 1];
    if (
      !current ||
      !next ||
      next.timestamp === current.timestamp ||
      ordered[index - 1]?.timestamp === current.timestamp
    )
      continue;
    intervals.push({
      nodeId: current.nodeId,
      start: current.timestamp,
      duration: next.timestamp - current.timestamp,
    });
  }
  return intervals;
}
