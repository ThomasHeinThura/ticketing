import { describe, expect, it } from "vitest";
import {
  accumulateCpuProfileChunk,
  CPU_PROFILE_LIMITS,
  type CpuProfileChunkInput,
  type CpuProfileNode,
  cpuProfileStartTimestamp,
  createCpuProfileAccumulator,
  createCpuProfileStartRegistry,
  finalizeCpuProfileCapture,
  normalizeCpuProfileChunkData,
  normalizeCpuProfileSource,
  recordCpuProfileStart,
} from "./performance-cpu-profile-capture";
import { summarizeProfileCoverage } from "./performance-profile-intervals";

function node(id: number): CpuProfileNode {
  return {
    id,
    callFrame: {
      functionName: "safe internal value",
      url: "https://taskdesk.invalid/assets/chunk.js",
      lineNumber: 0,
      columnNumber: 0,
    },
  };
}

function chunk(
  key: string,
  overrides: Partial<CpuProfileChunkInput> = {},
): CpuProfileChunkInput {
  return {
    key,
    id: key,
    source: "sampling",
    pid: 1,
    tid: 2,
    profileStartTimestamp: 0,
    nodes: [node(1)],
    sampleIds: [1],
    timeDeltas: [1],
    ...overrides,
  };
}

describe("bounded CPU profile chunk capture", () => {
  it("joins native Profile and ProfileChunk events across their different thread ids", () => {
    const profileEvent = {
      pid: 41,
      tid: 0,
      id: "native-profile",
      ts: 1_000,
      args: { data: { source: "Inspector", startTime: 1_000 } },
    };
    const chunkEvent = {
      pid: 41,
      tid: 73,
      id: "native-profile",
      ts: 1_700,
      args: {
        data: {
          source: "Inspector",
          cpuProfile: { nodes: [node(1)], samples: [1] },
          timeDeltas: [25],
        },
      },
    };
    const registry = createCpuProfileStartRegistry();
    const profileSource = normalizeCpuProfileSource(
      profileEvent.args.data.source,
    );
    const chunkSource = normalizeCpuProfileSource(chunkEvent.args.data.source);
    recordCpuProfileStart(
      registry,
      { id: profileEvent.id, source: profileSource, pid: profileEvent.pid },
      profileEvent.ts,
    );
    const anchor = cpuProfileStartTimestamp(registry, {
      id: chunkEvent.id,
      source: chunkSource,
      pid: chunkEvent.pid,
    });
    const normalized = normalizeCpuProfileChunkData(chunkEvent.args.data);
    const capture = createCpuProfileAccumulator();
    accumulateCpuProfileChunk(capture, {
      ...chunk("native-profile", { profileStartTimestamp: anchor }),
      ...normalized,
      id: chunkEvent.id,
      source: chunkSource,
      pid: chunkEvent.pid,
      tid: chunkEvent.tid,
    });

    expect(registry.timestamps.size).toBe(1);
    expect(capture.profiles.get("native-profile")?.samples).toEqual([
      { nodeId: 1, start: 1_000, duration: 25 },
    ]);
    expect(
      finalizeCpuProfileCapture(capture).omissions["malformed-chunk"],
    ).toBe(0);
  });

  it("caps retained profile start identities at the profile limit", () => {
    const registry = createCpuProfileStartRegistry();
    for (let index = 0; index < CPU_PROFILE_LIMITS.profiles; index += 1)
      recordCpuProfileStart(
        registry,
        { id: `profile-${index}`, source: "Inspector", pid: 1 },
        index,
      );
    recordCpuProfileStart(
      registry,
      { id: "overflow-profile", source: "Inspector", pid: 1 },
      500,
    );

    expect(registry.timestamps.size).toBe(CPU_PROFILE_LIMITS.profiles);
    expect(
      cpuProfileStartTimestamp(registry, {
        id: "overflow-profile",
        source: "Inspector",
        pid: 1,
      }),
    ).toBeUndefined();
  });

  it("anchors ordered sample deltas at Profile across delayed chunks and recorder edges", () => {
    const capture = createCpuProfileAccumulator();
    accumulateCpuProfileChunk(
      capture,
      chunk("delayed", {
        profileStartTimestamp: 1_000,
        sampleIds: [1, 1],
        timeDeltas: [100, 50],
      }),
    );
    accumulateCpuProfileChunk(
      capture,
      chunk("delayed", {
        sampleIds: [1],
        timeDeltas: [50],
      }),
    );

    const samples = capture.profiles.get("delayed")?.samples;
    expect(samples).toEqual([
      { nodeId: 1, start: 1_000, duration: 100 },
      { nodeId: 1, start: 1_100, duration: 50 },
      { nodeId: 1, start: 1_150, duration: 50 },
    ]);
    expect(
      summarizeProfileCoverage(
        samples?.map(({ start, duration }) => ({
          start,
          end: start + duration,
        })) ?? [],
        1_100,
        1_200,
      ),
    ).toMatchObject({ unionCoverage: 100, uncoveredPrefix: 0 });
  });

  it("omits a profile when its initial Profile timestamp is missing", () => {
    const capture = createCpuProfileAccumulator();
    accumulateCpuProfileChunk(
      capture,
      chunk("missing-anchor", { profileStartTimestamp: undefined }),
    );

    expect(finalizeCpuProfileCapture(capture)).toMatchObject({
      retainedProfiles: 0,
      omittedProfiles: 1,
      omissions: { "malformed-chunk": 1 },
    });
  });

  it("uses fixed native source labels and never retains arbitrary source text", () => {
    expect(normalizeCpuProfileSource(undefined)).toBe("sampling");
    expect(normalizeCpuProfileSource("Internal")).toBe("Internal");
    expect(normalizeCpuProfileSource("Inspector")).toBe("Inspector");
    expect(normalizeCpuProfileSource("SelfProfiling")).toBe("SelfProfiling");
    expect(normalizeCpuProfileSource("private/path?token=secret")).toBe(
      "unknown-source",
    );
  });

  it("normalizes native node-only, sample-only, and end metadata chunks", () => {
    const capture = createCpuProfileAccumulator();
    const nodeOnly = normalizeCpuProfileChunkData({
      cpuProfile: { nodes: [node(1)] },
    });
    expect(nodeOnly).toMatchObject({
      malformed: false,
      shape: "nodes-only",
      sampleIds: [],
      timeDeltas: [],
    });
    accumulateCpuProfileChunk(capture, {
      ...chunk("native-1"),
      ...nodeOnly,
    });

    const samplesOnly = normalizeCpuProfileChunkData({
      cpuProfile: { samples: [1] },
      timeDeltas: [5],
    });
    expect(samplesOnly).toMatchObject({ malformed: false, shape: "sampled" });
    accumulateCpuProfileChunk(capture, {
      ...chunk("native-1"),
      ...samplesOnly,
    });

    const finalChunk = normalizeCpuProfileChunkData({ endTime: 15 });
    expect(finalChunk).toMatchObject({
      malformed: false,
      shape: "metadata-only",
    });
    accumulateCpuProfileChunk(capture, {
      ...chunk("native-1"),
      ...finalChunk,
    });

    expect(finalizeCpuProfileCapture(capture)).toMatchObject({
      retainedProfiles: 1,
      completeProfiles: 1,
      omittedProfiles: 0,
      chunks: { metadataOnly: 1, nodesOnly: 1, sampled: 1, malformed: 0 },
    });
  });

  it("accepts V8 root frames with omitted optional URL and source coordinates", () => {
    const capture = createCpuProfileAccumulator();
    const nativeRoot = {
      id: 1,
      callFrame: { functionName: "(root)", scriptId: "0" },
    };
    const nodeOnly = normalizeCpuProfileChunkData({
      cpuProfile: { nodes: [nativeRoot] },
    });
    accumulateCpuProfileChunk(capture, {
      ...chunk("native-root"),
      ...nodeOnly,
    });
    const sampleChunk = normalizeCpuProfileChunkData({
      cpuProfile: { samples: [1] },
      timeDeltas: [2],
    });
    accumulateCpuProfileChunk(capture, {
      ...chunk("native-root"),
      ...sampleChunk,
    });
    expect(capture.profiles.get("native-root")?.nodes.get(1)).toMatchObject({
      id: 1,
      callFrame: { url: "", lineNumber: -1, columnNumber: -1 },
    });
    expect(
      finalizeCpuProfileCapture(capture).omissions["malformed-chunk"],
    ).toBe(0);
  });

  it("keeps malformed field pairings explicitly counted", () => {
    const normalized = normalizeCpuProfileChunkData({
      cpuProfile: { samples: [1] },
    });
    expect(normalized).toMatchObject({ malformed: true, shape: "malformed" });
    const capture = createCpuProfileAccumulator();
    accumulateCpuProfileChunk(capture, {
      ...chunk("malformed-native"),
      ...normalized,
    });
    expect(finalizeCpuProfileCapture(capture)).toMatchObject({
      omittedProfiles: 1,
      chunks: { malformed: 1 },
      omissions: { "malformed-chunk": 1 },
    });
  });

  it("drops a profile immediately when node limits are crossed across chunks", () => {
    const capture = createCpuProfileAccumulator();
    const firstHalf = Array.from({ length: 2_500 }, (_, index) => node(index));
    const secondHalf = Array.from({ length: 2_500 }, (_, index) =>
      node(index + 2_500),
    );
    accumulateCpuProfileChunk(
      capture,
      chunk("first-profile", { nodes: firstHalf }),
    );
    accumulateCpuProfileChunk(
      capture,
      chunk("first-profile", { nodes: secondHalf }),
    );
    expect(capture.retainedNodes).toBe(CPU_PROFILE_LIMITS.nodesPerProfile);
    accumulateCpuProfileChunk(
      capture,
      chunk("first-profile", { nodes: [node(5_000)] }),
    );
    expect(capture.profiles.get("first-profile")?.nodes.size).toBe(0);
    expect(capture.profiles.get("first-profile")?.omissionReason).toBe(
      "node-limit",
    );
    expect(capture.retainedNodes).toBe(0);
    accumulateCpuProfileChunk(capture, chunk("second-profile"));
    const status = finalizeCpuProfileCapture(capture);
    expect(status).toMatchObject({
      retainedProfiles: 1,
      completeProfiles: 1,
      omittedProfiles: 1,
      omissions: { "node-limit": 1 },
    });
    expect(status).not.toHaveProperty("profileKeys");
  });

  it("enforces aggregate node limits across distinct profile keys", () => {
    const capture = createCpuProfileAccumulator();
    for (let profile = 0; profile < 4; profile += 1) {
      const base = profile * 10_000;
      accumulateCpuProfileChunk(
        capture,
        chunk(`profile-${profile}`, {
          nodes: Array.from({ length: 2_500 }, (_, index) =>
            node(base + index),
          ),
        }),
      );
      accumulateCpuProfileChunk(
        capture,
        chunk(`profile-${profile}`, {
          nodes: Array.from({ length: 2_500 }, (_, index) =>
            node(base + index + 2_500),
          ),
        }),
      );
    }
    expect(capture.retainedNodes).toBe(CPU_PROFILE_LIMITS.nodesPerCapture);
    accumulateCpuProfileChunk(capture, chunk("fifth-profile"));
    const status = finalizeCpuProfileCapture(capture);
    expect(status.omissions["node-limit"]).toBe(1);
    expect(status.completeProfiles).toBe(4);
    expect(capture.retainedNodes).toBe(CPU_PROFILE_LIMITS.nodesPerCapture);
  });

  it("enforces per-profile sample limits across chunks and stops retaining", () => {
    const capture = createCpuProfileAccumulator();
    const half = CPU_PROFILE_LIMITS.samplesPerProfile / 2;
    const sampleIds = Array.from({ length: half }, () => 1);
    const timeDeltas = Array.from({ length: half }, () => 1);
    accumulateCpuProfileChunk(
      capture,
      chunk("busy-profile", { sampleIds, timeDeltas }),
    );
    accumulateCpuProfileChunk(
      capture,
      chunk("busy-profile", { sampleIds, timeDeltas }),
    );
    expect(capture.retainedSamples).toBe(100_000);
    accumulateCpuProfileChunk(
      capture,
      chunk("busy-profile", { sampleIds: [1], timeDeltas: [1] }),
    );
    expect(capture.retainedSamples).toBe(0);
    expect(capture.profiles.get("busy-profile")?.samples).toHaveLength(0);
    expect(finalizeCpuProfileCapture(capture).omissions["sample-limit"]).toBe(
      1,
    );
  });

  it("enforces aggregate sample limits across profile keys", () => {
    const capture = createCpuProfileAccumulator();
    const sampleCount = 66_667;
    const sampleIds = Array.from({ length: sampleCount }, () => 1);
    const timeDeltas = Array.from({ length: sampleCount }, () => 1);
    for (let profile = 0; profile < 2; profile += 1)
      accumulateCpuProfileChunk(
        capture,
        chunk(`sample-profile-${profile}`, { sampleIds, timeDeltas }),
      );
    expect(capture.retainedSamples).toBe(133_334);
    accumulateCpuProfileChunk(
      capture,
      chunk("sample-profile-overflow", { sampleIds, timeDeltas }),
    );
    const status = finalizeCpuProfileCapture(capture);
    expect(status.omissions["sample-limit"]).toBe(1);
    expect(status.completeProfiles).toBe(2);
    expect(capture.retainedSamples).toBe(133_334);
  });

  it("caps retained keys and reports malformed chunks with fixed counts", () => {
    const capture = createCpuProfileAccumulator();
    accumulateCpuProfileChunk(
      capture,
      chunk("malformed-profile", { sampleIds: [1, 2], timeDeltas: [1] }),
    );
    for (
      let profile = 0;
      profile < CPU_PROFILE_LIMITS.profiles - 1;
      profile += 1
    )
      accumulateCpuProfileChunk(capture, chunk(`profile-${profile}`));
    accumulateCpuProfileChunk(capture, chunk("profile-overflow"));
    accumulateCpuProfileChunk(capture, chunk("invalid profile key"));
    const status = finalizeCpuProfileCapture(capture);
    expect(capture.profiles.size).toBe(CPU_PROFILE_LIMITS.profiles);
    expect(status.omissions["profile-key-limit"]).toBe(1);
    expect(status.omissions["invalid-profile-key"]).toBe(1);
    expect(status.omissions["malformed-chunk"]).toBe(1);
    expect(status.omittedProfiles).toBe(1);
  });
});
