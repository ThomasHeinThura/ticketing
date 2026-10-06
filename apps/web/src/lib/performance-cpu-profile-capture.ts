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
};

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
  timestamp: number;
  nodes: readonly CpuProfileNode[];
  sampleIds: readonly number[];
  timeDeltas: readonly number[];
  malformed?: boolean;
};

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
    },
    retainedNodes: 0,
    retainedSamples: 0,
    finalized: false,
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

function safeNode(node: CpuProfileNode): CpuProfileNode | null {
  const callFrame = node?.callFrame;
  if (
    !Number.isSafeInteger(node?.id) ||
    node.id < 0 ||
    !callFrame ||
    typeof callFrame.functionName !== "string" ||
    callFrame.functionName.length > 256 ||
    typeof callFrame.url !== "string" ||
    callFrame.url.length > 1_024 ||
    !Number.isSafeInteger(callFrame.lineNumber) ||
    !Number.isSafeInteger(callFrame.columnNumber) ||
    (node.parent !== undefined &&
      (!Number.isSafeInteger(node.parent) || node.parent < 0))
  )
    return null;
  return {
    id: node.id,
    ...(node.parent !== undefined ? { parent: node.parent } : {}),
    callFrame: {
      functionName: callFrame.functionName,
      url: callFrame.url,
      lineNumber: callFrame.lineNumber,
      columnNumber: callFrame.columnNumber,
    },
  };
}

export function accumulateCpuProfileChunk(
  accumulator: CpuProfileAccumulator,
  input: CpuProfileChunkInput,
) {
  if (accumulator.finalized) return;
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
    !Number.isFinite(input.timestamp)
  ) {
    dropProfile(accumulator, profile, "malformed-chunk");
    return;
  }
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
    input.timeDeltas.some((delta) => !Number.isFinite(delta) || delta < 0) ||
    input.sampleIds.some(
      (nodeId) => !Number.isSafeInteger(nodeId) || nodeId < 0,
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
  for (const delta of input.timeDeltas) totalDelta += delta;
  if (!Number.isFinite(totalDelta)) {
    dropProfile(accumulator, profile, "malformed-chunk");
    return;
  }

  for (const node of safeNodes) profile.nodes.set(node.id, node);
  accumulator.retainedNodes += safeNodes.length;
  let sampleTime = input.timestamp - totalDelta;
  if (!Number.isFinite(sampleTime)) {
    dropProfile(accumulator, profile, "malformed-chunk");
    return;
  }
  for (const [index, nodeId] of input.sampleIds.entries()) {
    const duration = input.timeDeltas[index] ?? 0;
    profile.samples.push({ nodeId, start: sampleTime, duration });
    sampleTime += duration;
  }
  accumulator.retainedSamples += input.sampleIds.length;
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
