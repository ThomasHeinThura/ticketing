import { describe, expect, it } from "vitest";
import { clipProfileIntervals } from "./performance-profile-intervals";
import {
  anchorTraceProfile,
  type TraceProfileClock,
  timeTraceProfileChunk,
  traceProfileKey,
} from "./performance-trace-profile-clock";

describe("V8 trace profile sample clock", () => {
  it("keeps delayed chunks on the initial Profile clock across a boundary", () => {
    const clocks = new Map<string, TraceProfileClock>();
    const key = traceProfileKey(10, 20, "sampling", "profile-a");
    expect(anchorTraceProfile(clocks, key, 1_000_000)).toBe(true);

    const first = timeTraceProfileChunk(clocks.get(key), [1, 1], [100, 100]);
    // A later chunk's own trace event may be emitted well after its samples.
    const second = timeTraceProfileChunk(clocks.get(key), [1, 1], [100, 100]);

    expect([...(first ?? []), ...(second ?? [])]).toEqual([
      { nodeId: 1, start: 1_000_000, duration: 100 },
      { nodeId: 1, start: 1_000_100, duration: 100 },
      { nodeId: 1, start: 1_000_200, duration: 100 },
      { nodeId: 1, start: 1_000_300, duration: 100 },
    ]);
    expect(
      clipProfileIntervals(
        [...(first ?? []), ...(second ?? [])].map(({ start, duration }) => ({
          start,
          end: start + duration,
        })),
        1_000_350,
        1_000_450,
      ),
    ).toEqual([{ start: 1_000_350, end: 1_000_400 }]);
  });

  it("does not move the cursor for metadata-only and nodes-only chunks", () => {
    const clocks = new Map<string, TraceProfileClock>();
    const key = traceProfileKey(10, 20, "sampling", "profile-a");
    anchorTraceProfile(clocks, key, 5_000);
    expect(timeTraceProfileChunk(clocks.get(key), [], [])).toEqual([]);
    expect(clocks.get(key)?.nextSampleTimestamp).toBe(5_000);
    expect(timeTraceProfileChunk(clocks.get(key), [3], [25])).toEqual([
      { nodeId: 3, start: 5_000, duration: 25 },
    ]);
  });

  it("keeps profile cursors distinct across process, thread, source, and id", () => {
    const clocks = new Map<string, TraceProfileClock>();
    const baseKey = traceProfileKey(10, 20, "sampling", "profile-a");
    const otherThread = traceProfileKey(10, 21, "sampling", "profile-a");
    const otherProcess = traceProfileKey(11, 20, "sampling", "profile-a");
    const otherSource = traceProfileKey(10, 20, "Inspector", "profile-a");
    const otherId = traceProfileKey(10, 20, "sampling", "profile-b");
    for (const [key, timestamp] of [
      [baseKey, 1_000],
      [otherThread, 2_000],
      [otherProcess, 3_000],
      [otherSource, 4_000],
      [otherId, 5_000],
    ] as const)
      anchorTraceProfile(clocks, key, timestamp);

    expect(
      timeTraceProfileChunk(clocks.get(baseKey), [1], [10])?.[0].start,
    ).toBe(1_000);
    expect(
      timeTraceProfileChunk(clocks.get(otherThread), [1], [10])?.[0].start,
    ).toBe(2_000);
    expect(clocks.size).toBe(5);
  });

  it("does not recover a sample chunk from its delayed event timestamp", () => {
    expect(timeTraceProfileChunk(undefined, [1], [100])).toBeUndefined();
    const clocks = new Map<string, TraceProfileClock>();
    const key = traceProfileKey(1, 2, "sampling", "profile-a");
    expect(anchorTraceProfile(clocks, key, Number.NaN)).toBe(false);
    expect(clocks.has(key)).toBe(false);
  });

  it("rejects malformed deltas without advancing the profile cursor", () => {
    const clocks = new Map<string, TraceProfileClock>();
    const key = traceProfileKey(1, 2, "sampling", "profile-a");
    anchorTraceProfile(clocks, key, 100);
    expect(timeTraceProfileChunk(clocks.get(key), [1], [-1])).toBeUndefined();
    expect(clocks.get(key)?.nextSampleTimestamp).toBe(100);
  });
});
