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
  samples: Array<{ nodeId: number; start: number; duration: number }>;
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
      (delta) =>
        typeof delta !== "number" || !Number.isFinite(delta) || delta < 0,
    ) ||
    input.sampleIds.some(
      (nodeId) =>
        typeof nodeId !== "number" ||
        !Number.isSafeInteger(nodeId) ||
        nodeId < 0,
    )
  ) {
    dropProfile(accumulator, profile, "malformed-chunk");
    return;
  }

  const safeNodes: CpuProfileNode[] = [];
  const chunkNodeIds = new Set<number>();
  for (const node of input.nodes) {
    const safe = safeNode(node);
    if (!safe) {
      dropProfile(accumulator, profile, "malformed-chunk");
      return;
    }
    if (!profile.nodes.has(safe.id) && !chunkNodeIds.has(safe.id))
      safeNodes.push(safe);
    chunkNodeIds.add(safe.id);
  }
  let totalDelta = 0;
  for (const delta of timeDeltas) totalDelta += delta;
  if (!Number.isFinite(totalDelta)) {
    dropProfile(accumulator, profile, "malformed-chunk");
    return;
  }

  for (const node of safeNodes) profile.nodes.set(node.id, node);
  accumulator.retainedNodes += safeNodes.length;
  let sampleTime = profile.nextSampleTimestamp ?? input.profileStartTimestamp;
  if (
    typeof sampleTime !== "number" ||
    !Number.isFinite(sampleTime) ||
    !Number.isFinite(sampleTime + totalDelta)
  ) {
    dropProfile(accumulator, profile, "malformed-chunk");
    return;
  }
  for (const [index, nodeId] of sampleIds.entries()) {
    const duration = timeDeltas[index] ?? 0;
    profile.samples.push({ nodeId, start: sampleTime, duration });
    sampleTime += duration;
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
