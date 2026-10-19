import { describe, expect, it } from "vitest";
import { clipProfileIntervals } from "./performance-profile-intervals";
import {
  createTraceProfileState,
  ingestTraceProfileEvent,
  type TraceProfileEventInput,
  timeTraceProfileChunk,
  traceProfileKey,
} from "./performance-trace-profile-clock";

function head(
  overrides: Partial<TraceProfileEventInput> = {},
): TraceProfileEventInput {
  return {
    name: "Profile",
    pid: 10,
    tid: 20,
    id: "profile-a",
    source: "Internal",
    timestamp: 1_000_000,
    ...overrides,
  };
}

function chunk(
  overrides: Partial<TraceProfileEventInput> = {},
): TraceProfileEventInput {
  return {
    name: "ProfileChunk",
    pid: 10,
    tid: 21,
    id: "profile-a",
    source: "Internal",
    samples: [1],
    timeDeltas: [100],
    ...overrides,
  };
}

describe("V8 trace profile event correlation", () => {
  it("joins chunks across event TIDs and keeps the head's owner TID and clock", () => {
    const state = createTraceProfileState();
    const anchor = ingestTraceProfileEvent(state, head());
    const first = ingestTraceProfileEvent(
      state,
      chunk({
        tid: 21,
        timestamp: 9_000_000,
        samples: [1, 1],
        timeDeltas: [100, 100],
      }),
    );
    const second = ingestTraceProfileEvent(
      state,
      chunk({
        tid: 22,
        timestamp: 12_000_000,
        samples: [1, 1],
        timeDeltas: [100, 100],
      }),
    );

    expect(anchor.status).toBe("anchored");
    expect(first).toMatchObject({
      status: "chunk",
      ownerTid: 20,
      source: "Internal",
      samples: [
        { nodeId: 1, start: 1_000_000, duration: 100 },
        { nodeId: 1, start: 1_000_100, duration: 100 },
      ],
    });
    expect(second).toMatchObject({
      status: "chunk",
      ownerTid: 20,
      samples: [
        { nodeId: 1, start: 1_000_200, duration: 100 },
        { nodeId: 1, start: 1_000_300, duration: 100 },
      ],
    });
    const joined = [
      ...(first.status === "chunk" ? first.samples : []),
      ...(second.status === "chunk" ? second.samples : []),
    ];
    expect(
      clipProfileIntervals(
        joined.map(({ start, duration }) => ({ start, end: start + duration })),
        1_000_350,
        1_000_450,
      ),
    ).toEqual([{ start: 1_000_350, end: 1_000_400 }]);
  });

  it("keeps process and profile IDs isolated while permitting concurrent profiles", () => {
    const state = createTraceProfileState();
    expect(ingestTraceProfileEvent(state, head())).toMatchObject({
      status: "anchored",
    });
    expect(
      ingestTraceProfileEvent(
        state,
        head({ pid: 11, tid: 30, timestamp: 2_000, id: "profile-a" }),
      ),
    ).toMatchObject({ status: "anchored" });
    expect(
      ingestTraceProfileEvent(
        state,
        head({ pid: 10, tid: 40, timestamp: 3_000, id: "profile-b" }),
      ),
    ).toMatchObject({ status: "anchored" });

    expect(
      ingestTraceProfileEvent(
        state,
        chunk({ pid: 10, id: "profile-a", tid: 50 }),
      ),
    ).toMatchObject({
      status: "chunk",
      ownerTid: 20,
      samples: [{ start: 1_000_000 }],
    });
    expect(
      ingestTraceProfileEvent(
        state,
        chunk({ pid: 11, id: "profile-a", tid: 51 }),
      ),
    ).toMatchObject({
      status: "chunk",
      ownerTid: 30,
      samples: [{ start: 2_000 }],
    });
    expect(
      ingestTraceProfileEvent(
        state,
        chunk({ pid: 10, id: "profile-b", tid: 52 }),
      ),
    ).toMatchObject({
      status: "chunk",
      ownerTid: 40,
      samples: [{ start: 3_000 }],
    });
  });

  it("allows legacy missing source tags but rejects conflicting tags", () => {
    const state = createTraceProfileState();
    expect(
      ingestTraceProfileEvent(state, head({ source: undefined })),
    ).toMatchObject({ status: "anchored" });
    expect(
      ingestTraceProfileEvent(state, chunk({ source: undefined })),
    ).toMatchObject({ status: "chunk", source: undefined });
    expect(
      ingestTraceProfileEvent(state, chunk({ source: "Internal" })),
    ).toMatchObject({ status: "chunk", source: "Internal" });

    const conflicting = createTraceProfileState();
    ingestTraceProfileEvent(conflicting, head());
    expect(
      ingestTraceProfileEvent(conflicting, chunk({ source: "Inspector" })),
    ).toMatchObject({
      status: "invalid",
      key: traceProfileKey(10, "profile-a"),
    });
    expect(conflicting.anchors.size).toBe(0);
    expect(conflicting.invalidKeys).toContain(traceProfileKey(10, "profile-a"));

    const conflictingChunks = createTraceProfileState();
    ingestTraceProfileEvent(conflictingChunks, head({ source: undefined }));
    expect(
      ingestTraceProfileEvent(conflictingChunks, chunk({ source: "Internal" }))
        .status,
    ).toBe("chunk");
    expect(
      ingestTraceProfileEvent(
        conflictingChunks,
        chunk({ source: "Inspector" }),
      ),
    ).toMatchObject({ status: "invalid" });
    expect(conflictingChunks.anchors.size).toBe(0);
  });

  it("keeps metadata-only chunks from advancing the anchored sample clock", () => {
    const state = createTraceProfileState();
    ingestTraceProfileEvent(state, head({ timestamp: 5_000 }));
    expect(
      ingestTraceProfileEvent(
        state,
        chunk({ samples: [], timeDeltas: [], timestamp: 9_000_000 }),
      ),
    ).toMatchObject({ status: "chunk", samples: [] });
    expect(
      ingestTraceProfileEvent(
        state,
        chunk({ samples: [3], timeDeltas: [25], timestamp: 11_000_000 }),
      ),
    ).toMatchObject({
      status: "chunk",
      samples: [{ nodeId: 3, start: 5_000, duration: 25 }],
    });
  });

  it("fails closed on absent identity and never aliases missing IDs", () => {
    const state = createTraceProfileState();
    expect(traceProfileKey(undefined, "profile-a")).toBeUndefined();
    expect(traceProfileKey(10, undefined)).toBeUndefined();
    expect(traceProfileKey(10, "")).toBeUndefined();
    expect(traceProfileKey(Number.NaN, "profile-a")).toBeUndefined();
    expect(ingestTraceProfileEvent(state, head({ pid: undefined }))).toEqual({
      status: "invalid",
    });
    expect(ingestTraceProfileEvent(state, head({ id: undefined }))).toEqual({
      status: "invalid",
    });
    expect(ingestTraceProfileEvent(state, head({ id: "" }))).toEqual({
      status: "invalid",
    });
    expect(state.anchors.size).toBe(0);
    expect(state.invalidKeys.size).toBe(0);
  });

  it("invalidates duplicate heads rather than choosing an owner or timestamp", () => {
    const state = createTraceProfileState();
    const key = traceProfileKey(10, "profile-a");
    if (key === undefined) throw new Error("Expected a valid profile key");
    ingestTraceProfileEvent(state, head());
    expect(
      ingestTraceProfileEvent(state, head({ tid: 99, timestamp: 2_000_000 })),
    ).toMatchObject({ status: "invalid", key });
    expect(state.anchors.has(key)).toBe(false);
    expect(ingestTraceProfileEvent(state, chunk())).toMatchObject({
      status: "invalid",
      key,
    });
  });

  it("rejects chunks before a head and does not use their event timestamp", () => {
    const state = createTraceProfileState();
    const key = traceProfileKey(10, "profile-a");
    if (key === undefined) throw new Error("Expected a valid profile key");
    expect(
      ingestTraceProfileEvent(state, chunk({ timestamp: 9_999_999 })),
    ).toMatchObject({ status: "invalid", key });
    expect(ingestTraceProfileEvent(state, head())).toMatchObject({
      status: "invalid",
      key,
    });
    expect(state.anchors.has(key)).toBe(false);
  });

  it("rejects invalid anchors and malformed chunks without using them", () => {
    for (const invalidHead of [
      head({ tid: undefined }),
      head({ tid: Number.NaN }),
      head({ timestamp: Number.NaN }),
      head({ timestamp: "1000" }),
      head({ source: null }),
    ]) {
      const state = createTraceProfileState();
      expect(ingestTraceProfileEvent(state, invalidHead).status).toBe(
        "invalid",
      );
      expect(ingestTraceProfileEvent(state, chunk()).status).toBe("invalid");
    }

    for (const invalidChunk of [
      chunk({ samples: [1, 2], timeDeltas: [10] }),
      chunk({ samples: [1], timeDeltas: [-1] }),
      chunk({ samples: [Number.NaN], timeDeltas: [10] }),
      chunk({ samples: [1], timeDeltas: [Number.POSITIVE_INFINITY] }),
      chunk({ samples: null, timeDeltas: [10] }),
    ]) {
      const state = createTraceProfileState();
      ingestTraceProfileEvent(state, head());
      expect(ingestTraceProfileEvent(state, invalidChunk).status).toBe(
        "invalid",
      );
      expect(state.anchors.size).toBe(0);
    }
  });

  it("does not advance the clock after malformed samples or timestamp overflow", () => {
    const malformedClock = {
      profileStartTimestamp: 100,
      nextSampleTimestamp: 100,
    };
    expect(timeTraceProfileChunk(malformedClock, [1, 2], [10])).toBeUndefined();
    expect(malformedClock.nextSampleTimestamp).toBe(100);
    expect(timeTraceProfileChunk(malformedClock, [1], [-1])).toBeUndefined();
    expect(malformedClock.nextSampleTimestamp).toBe(100);

    const overflowClock = {
      profileStartTimestamp: Number.MAX_VALUE,
      nextSampleTimestamp: Number.MAX_VALUE,
    };
    expect(
      timeTraceProfileChunk(overflowClock, [1], [Number.MAX_VALUE]),
    ).toBeUndefined();
    expect(overflowClock.nextSampleTimestamp).toBe(Number.MAX_VALUE);
  });
});
