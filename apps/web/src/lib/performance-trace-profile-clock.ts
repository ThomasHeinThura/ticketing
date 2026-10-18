export type TraceProfileClock = {
  profileStartTimestamp: number;
  nextSampleTimestamp: number;
};

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
      samples: TimedTraceSample[];
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
