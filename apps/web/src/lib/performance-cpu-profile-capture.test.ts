import { describe, expect, it } from "vitest";
import {
  accumulateCpuProfileChunk,
  CPU_PROFILE_LIMITS,
  type CpuProfileChunkInput,
  type CpuProfileNode,
  createCpuProfileAccumulator,
  finalizeCpuProfileCapture,
} from "./performance-cpu-profile-capture";

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
    timestamp: 20,
    nodes: [node(1)],
    sampleIds: [1],
    timeDeltas: [1],
    ...overrides,
  };
}

describe("bounded CPU profile chunk capture", () => {
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
