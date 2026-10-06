export const CPU_PROFILE_LIMITS = {
  profiles: 32,
  nodesPerProfile: 5_000,
  samplesPerProfile: 100_000,
  nodesPerCapture: 20_000,
  samplesPerCapture: 200_000,
} as const;

export type CpuProfileNode = {
  id: number;
  parent?: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
};

export type CpuProfile = {
  id: string;
  source: string;
  pid: number;
  tid: number;
  nodes: Map<number, CpuProfileNode>;
  samples: Array<{
    nodeId: number;
    start: number;
    duration: number;
    timestamp?: number;
  }>;
  profileStartTimestamp: number;
  nextSampleTimestamp?: number;
  omissionReason?: CpuProfileOmissionReason;
};

export type CpuProfileOmissionReason =
  | "profile-key-limit"
  | "invalid-profile-key"
  | "node-limit"
  | "sample-limit"
  | "malformed-chunk"
  | "no-samples";

export type CpuProfileCaptureStatus = {
  retainedProfiles: number;
  completeProfiles: number;
  omittedProfiles: number;
  omissions: Record<CpuProfileOmissionReason, number>;
  malformedReasons: {
    chunkFlag: number;
    sampleCountMismatch: number;
    missingStartTimestamp: number;
    invalidDelta: number;
    nonNumericDelta: number;
    nonFiniteDelta: number;
    nonSafeIntegerDelta: number;
    invalidSampleId: number;
    invalidNode: number;
    timestampOverflow: number;
  };
  deltaOrderingDiagnostics: {
    negativeCount: number;
    minimumNegativeMicroseconds: number | null;
    maximumNegativeMicroseconds: number | null;
    firstPosition: "first" | "middle" | "last" | null;
    hasPositivePredecessor: boolean;
    hasPositiveSuccessor: boolean;
    netChunkDeltaMicroseconds: number | null;
    minimumPrefixDeltaMicroseconds: number | null;
  };
  chunks: {
    metadataOnly: number;
    nodesOnly: number;
    sampled: number;
    malformed: number;
  };
};

export type CpuProfileChunkShape =
  | "metadata-only"
  | "nodes-only"
  | "sampled"
  | "malformed";

export type CpuProfileAccumulator = {
  profiles: Map<string, CpuProfile>;
  status: CpuProfileCaptureStatus;
  retainedNodes: number;
  retainedSamples: number;
  finalized: boolean;
};

export type CpuProfileStartIdentity = {
  id: string;
  source: string;
  pid: number;
};

export type CpuProfileStartRegistry = {
  timestamps: Map<string, number>;
};

export type CpuProfileChunkInput = {
  key: string;
  id: string;
  source: string;
  pid: number;
  tid: number;
  profileStartTimestamp?: number;
  nodes: readonly unknown[];
  sampleIds: readonly unknown[];
  timeDeltas: readonly unknown[];
  malformed?: boolean;
  shape?: CpuProfileChunkShape;
};

export type NormalizedCpuProfileChunk = {
  nodes: readonly unknown[];
  sampleIds: readonly unknown[];
  timeDeltas: readonly unknown[];
  malformed: boolean;
  shape: CpuProfileChunkShape;
};

export function normalizeCpuProfileSource(raw: unknown): string {
  if (raw === undefined) return "sampling";
  return raw === "Internal" || raw === "Inspector" || raw === "SelfProfiling"
    ? raw
    : "unknown-source";
}

const SAFE_PROFILE_KEY = /^[A-Za-z0-9_.:-]{1,180}$/;
const SAFE_PROFILE_PART = /^[A-Za-z0-9_.:-]{1,64}$/;

export function createCpuProfileStartRegistry(): CpuProfileStartRegistry {
  return { timestamps: new Map() };
}

function cpuProfileStartKey(identity: CpuProfileStartIdentity) {
  if (
    identity.source === "unknown-source" ||
    identity.id === "invalid-id" ||
    !SAFE_PROFILE_PART.test(identity.id) ||
    !SAFE_PROFILE_PART.test(identity.source) ||
    !Number.isSafeInteger(identity.pid) ||
    identity.pid < 0
  )
    return undefined;
  // V8's global Profile event uses TID 0; ProfileChunk uses the sampling thread.
  return `${identity.pid}:${identity.source}:${identity.id}`;
}

export function recordCpuProfileStart(
  registry: CpuProfileStartRegistry,
  identity: CpuProfileStartIdentity,
  timestamp: number,
) {
  const key = cpuProfileStartKey(identity);
  if (!key || !Number.isFinite(timestamp)) return;
  if (
    !registry.timestamps.has(key) &&
    registry.timestamps.size >= CPU_PROFILE_LIMITS.profiles
  )
    return;
  registry.timestamps.set(key, timestamp);
}

export function cpuProfileStartTimestamp(
  registry: CpuProfileStartRegistry,
  identity: CpuProfileStartIdentity,
) {
  const key = cpuProfileStartKey(identity);
  return key ? registry.timestamps.get(key) : undefined;
}

function increment(value: number) {
  return Math.min(value + 1, Number.MAX_SAFE_INTEGER);
}

export function createCpuProfileAccumulator(): CpuProfileAccumulator {
  return {
    profiles: new Map(),
    status: {
      retainedProfiles: 0,
      completeProfiles: 0,
      omittedProfiles: 0,
      omissions: {
        "profile-key-limit": 0,
        "invalid-profile-key": 0,
        "node-limit": 0,
        "sample-limit": 0,
        "malformed-chunk": 0,
        "no-samples": 0,
      },
      malformedReasons: {
        chunkFlag: 0,
        sampleCountMismatch: 0,
        missingStartTimestamp: 0,
        invalidDelta: 0,
        nonNumericDelta: 0,
        nonFiniteDelta: 0,
        nonSafeIntegerDelta: 0,
        invalidSampleId: 0,
        invalidNode: 0,
        timestampOverflow: 0,
      },
      deltaOrderingDiagnostics: {
        negativeCount: 0,
        minimumNegativeMicroseconds: null,
        maximumNegativeMicroseconds: null,
        firstPosition: null,
        hasPositivePredecessor: false,
        hasPositiveSuccessor: false,
        netChunkDeltaMicroseconds: null,
        minimumPrefixDeltaMicroseconds: null,
      },
      chunks: { metadataOnly: 0, nodesOnly: 0, sampled: 0, malformed: 0 },
    },
    retainedNodes: 0,
    retainedSamples: 0,
    finalized: false,
  };
}

/**
 * V8 streams ProfileChunk data incrementally. Its native serializer can emit
 * nodes without samples, samples without new nodes, and a final endTime-only
 * chunk. Normalize those documented optional fields without copying arrays;
 * the accumulator applies its limits before traversing or retaining them.
 */
export function normalizeCpuProfileChunkData(
  raw: unknown,
): NormalizedCpuProfileChunk {
  const malformed = (
    nodes: readonly unknown[] = [],
    sampleIds: readonly unknown[] = [],
    timeDeltas: readonly unknown[] = [],
  ): NormalizedCpuProfileChunk => ({
    nodes,
    sampleIds,
    timeDeltas,
    malformed: true,
    shape: "malformed",
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return malformed();

  const data = raw as Record<string, unknown>;
  const profile = data.cpuProfile;
  if (
    profile !== undefined &&
    (!profile || typeof profile !== "object" || Array.isArray(profile))
  )
    return malformed();
  const cpuProfile = (profile ?? {}) as Record<string, unknown>;
  const rawNodes = cpuProfile.nodes;
  const rawSamples = cpuProfile.samples;
  const rawDeltas = data.timeDeltas;
  if (
    (rawNodes !== undefined && !Array.isArray(rawNodes)) ||
    (rawSamples !== undefined && !Array.isArray(rawSamples)) ||
    (rawDeltas !== undefined && !Array.isArray(rawDeltas))
  )
    return malformed();

  const nodes = Array.isArray(rawNodes) ? rawNodes : [];
  const sampleIds = Array.isArray(rawSamples) ? rawSamples : [];
  const timeDeltas = Array.isArray(rawDeltas) ? rawDeltas : [];
  if (
    sampleIds.length !== timeDeltas.length ||
    (rawSamples === undefined && timeDeltas.length > 0)
  )
    return malformed(nodes, sampleIds, timeDeltas);

  return {
    nodes,
    sampleIds,
    timeDeltas,
    malformed: false,
    shape:
      sampleIds.length > 0
        ? "sampled"
        : nodes.length > 0
          ? "nodes-only"
          : "metadata-only",
  };
}

function omission(
  accumulator: CpuProfileAccumulator,
  reason: CpuProfileOmissionReason,
) {
  accumulator.status.omissions[reason] = increment(
    accumulator.status.omissions[reason],
  );
}

function dropProfile(
  accumulator: CpuProfileAccumulator,
  profile: CpuProfile,
  reason: CpuProfileOmissionReason,
) {
  if (profile.omissionReason) return;
  accumulator.retainedNodes -= profile.nodes.size;
  accumulator.retainedSamples -= profile.samples.length;
  profile.nodes.clear();
  profile.samples.length = 0;
  profile.omissionReason = reason;
  accumulator.status.omittedProfiles = increment(
    accumulator.status.omittedProfiles,
  );
  omission(accumulator, reason);
}

function safeNode(rawNode: unknown): CpuProfileNode | null {
  if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode))
    return null;
  const node = rawNode as Partial<CpuProfileNode>;
  const callFrame = node.callFrame;
  if (
    typeof node.id !== "number" ||
    !Number.isSafeInteger(node.id) ||
    node.id < 0 ||
    !callFrame ||
    typeof callFrame.functionName !== "string" ||
    callFrame.functionName.length > 256 ||
    (callFrame.url !== undefined &&
      (typeof callFrame.url !== "string" || callFrame.url.length > 1_024)) ||
    (callFrame.lineNumber !== undefined &&
      !Number.isSafeInteger(callFrame.lineNumber)) ||
    (callFrame.columnNumber !== undefined &&
      !Number.isSafeInteger(callFrame.columnNumber)) ||
    (node.parent !== undefined &&
      (!Number.isSafeInteger(node.parent) || node.parent < 0))
  )
    return null;
  return {
    id: node.id,
    ...(node.parent !== undefined ? { parent: node.parent } : {}),
    callFrame: {
      functionName: callFrame.functionName,
      url: callFrame.url ?? "",
      lineNumber: callFrame.lineNumber ?? -1,
      columnNumber: callFrame.columnNumber ?? -1,
    },
  };
}

export function accumulateCpuProfileChunk(
  accumulator: CpuProfileAccumulator,
  input: CpuProfileChunkInput,
) {
  if (accumulator.finalized) return;
  const chunkShape = input.malformed ? "malformed" : (input.shape ?? "sampled");
  const chunkCounter = {
    "metadata-only": "metadataOnly",
    "nodes-only": "nodesOnly",
    sampled: "sampled",
    malformed: "malformed",
  } as const satisfies Record<
    CpuProfileChunkShape,
    keyof CpuProfileCaptureStatus["chunks"]
  >;
  const chunkCountKey = chunkCounter[chunkShape];
  accumulator.status.chunks[chunkCountKey] = increment(
    accumulator.status.chunks[chunkCountKey],
  );
  let profile = accumulator.profiles.get(input.key);
  if (!profile) {
    if (
      !SAFE_PROFILE_KEY.test(input.key) ||
      !SAFE_PROFILE_PART.test(input.id) ||
      !SAFE_PROFILE_PART.test(input.source) ||
      !Number.isSafeInteger(input.pid) ||
      input.pid < 0 ||
      !Number.isSafeInteger(input.tid) ||
      input.tid < 0
    ) {
      omission(accumulator, "invalid-profile-key");
      return;
    }
    if (accumulator.profiles.size >= CPU_PROFILE_LIMITS.profiles) {
      omission(accumulator, "profile-key-limit");
      return;
    }
    profile = {
      id: input.id,
      source: input.source,
      pid: input.pid,
      tid: input.tid,
      nodes: new Map(),
      samples: [],
      profileStartTimestamp: input.profileStartTimestamp ?? 0,
    };
    accumulator.profiles.set(input.key, profile);
  }
  if (profile.omissionReason) return;

  if (
    input.malformed ||
    input.sampleIds.length !== input.timeDeltas.length ||
    (profile.nextSampleTimestamp === undefined &&
      (input.profileStartTimestamp === undefined ||
        !Number.isFinite(input.profileStartTimestamp)))
  ) {
    const reason = input.malformed
      ? "chunkFlag"
      : input.sampleIds.length !== input.timeDeltas.length
        ? "sampleCountMismatch"
        : "missingStartTimestamp";
    accumulator.status.malformedReasons[reason] = increment(
      accumulator.status.malformedReasons[reason],
    );
    dropProfile(accumulator, profile, "malformed-chunk");
    return;
  }

  const timeDeltas = input.timeDeltas as readonly number[];
  const sampleIds = input.sampleIds as readonly number[];
  if (
    profile.nodes.size + input.nodes.length >
      CPU_PROFILE_LIMITS.nodesPerProfile ||
    accumulator.retainedNodes + input.nodes.length >
      CPU_PROFILE_LIMITS.nodesPerCapture
  ) {
    dropProfile(accumulator, profile, "node-limit");
    return;
  }
  if (
    profile.samples.length + input.sampleIds.length >
      CPU_PROFILE_LIMITS.samplesPerProfile ||
    accumulator.retainedSamples + input.sampleIds.length >
      CPU_PROFILE_LIMITS.samplesPerCapture
  ) {
    dropProfile(accumulator, profile, "sample-limit");
    return;
  }
  if (
    input.timeDeltas.some(
      (delta) => typeof delta !== "number" || !Number.isSafeInteger(delta),
    ) ||
    input.sampleIds.some(
      (nodeId) =>
        typeof nodeId !== "number" ||
        !Number.isSafeInteger(nodeId) ||
        nodeId < 0,
    )
  ) {
    const malformedDeltaIndex = input.timeDeltas.findIndex(
      (delta) => typeof delta !== "number" || !Number.isSafeInteger(delta),
    );
    if (malformedDeltaIndex >= 0) {
      const malformedDelta = input.timeDeltas[malformedDeltaIndex];
      const reason =
        typeof malformedDelta !== "number"
          ? "nonNumericDelta"
          : !Number.isFinite(malformedDelta)
            ? "nonFiniteDelta"
            : "nonSafeIntegerDelta";
      accumulator.status.malformedReasons.invalidDelta = increment(
        accumulator.status.malformedReasons.invalidDelta,
      );
      accumulator.status.malformedReasons[reason] = increment(
        accumulator.status.malformedReasons[reason],
      );
    } else {
      accumulator.status.malformedReasons.invalidSampleId = increment(
        accumulator.status.malformedReasons.invalidSampleId,
      );
    }
    dropProfile(accumulator, profile, "malformed-chunk");
    return;
  }

  const negativeDeltas = timeDeltas.filter((delta) => delta < 0);
  if (negativeDeltas.length > 0) {
    let prefix = 0;
    let minimumPrefix = 0;
    let prefixOverflow = false;
    let minimumNegative = Number.POSITIVE_INFINITY;
    let maximumNegative = Number.NEGATIVE_INFINITY;
    for (const delta of timeDeltas) {
      prefix += delta;
      if (!Number.isSafeInteger(prefix)) {
        prefixOverflow = true;
        break;
      }
      minimumPrefix = Math.min(minimumPrefix, prefix);
      if (delta < 0) {
        minimumNegative = Math.min(minimumNegative, delta);
        maximumNegative = Math.max(maximumNegative, delta);
      }
    }
    const firstNegativeIndex = timeDeltas.findIndex((delta) => delta < 0);
    const diagnostics = accumulator.status.deltaOrderingDiagnostics;
    diagnostics.negativeCount = negativeDeltas.length;
    diagnostics.minimumNegativeMicroseconds = minimumNegative;
    diagnostics.maximumNegativeMicroseconds = maximumNegative;
    diagnostics.firstPosition =
      firstNegativeIndex === 0
        ? "first"
        : firstNegativeIndex === timeDeltas.length - 1
          ? "last"
          : "middle";
    diagnostics.hasPositivePredecessor =
      firstNegativeIndex > 0 && (timeDeltas[firstNegativeIndex - 1] ?? 0) > 0;
    diagnostics.hasPositiveSuccessor =
      firstNegativeIndex < timeDeltas.length - 1 &&
      (timeDeltas[firstNegativeIndex + 1] ?? 0) > 0;
    diagnostics.netChunkDeltaMicroseconds = prefixOverflow ? null : prefix;
    diagnostics.minimumPrefixDeltaMicroseconds = prefixOverflow
      ? null
      : minimumPrefix;
  }

  const safeNodes: CpuProfileNode[] = [];
  const chunkNodeIds = new Set<number>();
  for (const node of input.nodes) {
    const safe = safeNode(node);
    if (!safe) {
      accumulator.status.malformedReasons.invalidNode = increment(
        accumulator.status.malformedReasons.invalidNode,
      );
      dropProfile(accumulator, profile, "malformed-chunk");
      return;
    }
    if (!profile.nodes.has(safe.id) && !chunkNodeIds.has(safe.id))
      safeNodes.push(safe);
    chunkNodeIds.add(safe.id);
  }
  const initialSampleTime =
    profile.nextSampleTimestamp ?? input.profileStartTimestamp;
  if (
    typeof initialSampleTime !== "number" ||
    !Number.isSafeInteger(initialSampleTime)
  ) {
    accumulator.status.malformedReasons.timestampOverflow = increment(
      accumulator.status.malformedReasons.timestampOverflow,
    );
    dropProfile(accumulator, profile, "malformed-chunk");
    return;
  }
  let sampleTime = initialSampleTime;
  const sampleTimestamps: number[] = [];
  for (const index of sampleIds.keys()) {
    const duration = timeDeltas[index] ?? 0;
    sampleTime += duration;
    if (!Number.isSafeInteger(sampleTime)) {
      accumulator.status.malformedReasons.timestampOverflow = increment(
        accumulator.status.malformedReasons.timestampOverflow,
      );
      dropProfile(accumulator, profile, "malformed-chunk");
      return;
    }
    sampleTimestamps.push(sampleTime);
  }
  for (const node of safeNodes) profile.nodes.set(node.id, node);
  accumulator.retainedNodes += safeNodes.length;
  for (const [index, nodeId] of sampleIds.entries()) {
    profile.samples.push({
      nodeId,
      start: 0,
      duration: 0,
      timestamp: sampleTimestamps[index] ?? sampleTime,
    });
  }
  profile.nextSampleTimestamp = sampleTime;
  accumulator.retainedSamples += sampleIds.length;
}

export function finalizeCpuProfileCapture(
  accumulator: CpuProfileAccumulator,
): CpuProfileCaptureStatus {
  if (!accumulator.finalized) {
    accumulator.finalized = true;
    for (const profile of accumulator.profiles.values()) {
      if (profile.omissionReason || profile.samples.length > 0) continue;
      dropProfile(accumulator, profile, "no-samples");
    }
    for (const profile of accumulator.profiles.values()) {
      if (profile.omissionReason) continue;
      profile.samples.sort(
        (left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0),
      );
      let previousTimestamp = profile.profileStartTimestamp;
      for (const sample of profile.samples) {
        const timestamp = sample.timestamp ?? previousTimestamp;
        sample.start = previousTimestamp;
        sample.duration = Math.max(0, timestamp - previousTimestamp);
        previousTimestamp = Math.max(previousTimestamp, timestamp);
        delete sample.timestamp;
      }
    }
    accumulator.status.retainedProfiles = [
      ...accumulator.profiles.values(),
    ].filter((profile) => !profile.omissionReason).length;
    accumulator.status.completeProfiles = accumulator.status.retainedProfiles;
  }
  return {
    ...accumulator.status,
    omissions: { ...accumulator.status.omissions },
  };
}
