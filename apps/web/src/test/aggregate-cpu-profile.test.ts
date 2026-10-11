import { describe, expect, it } from "vitest";
import {
  aggregateCpuProfileFrames,
  sanitizeCpuProfileNodes,
} from "../../e2e/helpers/aggregate-cpu-profile";

describe("aggregateCpuProfileFrames", () => {
  it("reports self and inclusive time from child links", () => {
    const buckets = aggregateCpuProfileFrames([
      {
        nodes: [
          {
            id: 1,
            children: [2],
            functionName: "Board",
            asset: "board.js",
            line: 3,
            column: 4,
          },
          {
            id: 2,
            children: [3],
            functionName: "renderColumn",
            asset: "board.js",
            line: 8,
            column: 2,
          },
          {
            id: 3,
            functionName: "TaskCard",
            asset: "board.js",
            line: 12,
            column: 6,
          },
        ],
        samples: [
          { nodeId: 3, startMicroseconds: 10, durationMicroseconds: 7 },
          { nodeId: 2, startMicroseconds: 17, durationMicroseconds: 5 },
        ],
      },
    ]);

    expect(buckets).toEqual([
      {
        asset: "board.js",
        functionName: "renderColumn",
        line: 8,
        column: 2,
        selfSampledMicroseconds: 5,
        inclusiveSampledMicroseconds: 12,
        selfSampleCount: 1,
        inclusiveSampleCount: 2,
      },
      {
        asset: "board.js",
        functionName: "Board",
        line: 3,
        column: 4,
        selfSampledMicroseconds: 0,
        inclusiveSampledMicroseconds: 12,
        selfSampleCount: 0,
        inclusiveSampleCount: 2,
      },
      {
        asset: "board.js",
        functionName: "TaskCard",
        line: 12,
        column: 6,
        selfSampledMicroseconds: 7,
        inclusiveSampledMicroseconds: 7,
        selfSampleCount: 1,
        inclusiveSampleCount: 1,
      },
    ]);
  });

  it("preserves parent-only ProfileChunk ancestry through sanitization and aggregation", () => {
    const origin = "https://taskdesk.test";
    const nodes = sanitizeCpuProfileNodes(
      [
        {
          id: 1,
          callFrame: {
            functionName: "Board",
            url: `${origin}/assets/board.js`,
            lineNumber: 2,
            columnNumber: 3,
          },
        },
        {
          id: 2,
          parent: 1,
          callFrame: {
            functionName: "TaskCard",
            url: `${origin}/assets/board.js`,
            lineNumber: 10,
            columnNumber: 4,
          },
        },
      ],
      origin,
    );
    const buckets = aggregateCpuProfileFrames([
      {
        nodes,
        samples: [
          { nodeId: 2, startMicroseconds: 20, durationMicroseconds: 9 },
        ],
      },
    ]);

    expect(nodes[1]).toMatchObject({ id: 2, parent: 1, children: [] });
    expect(nodes[1]).not.toHaveProperty("url");
    expect(buckets).toEqual([
      {
        asset: "board.js",
        functionName: "TaskCard",
        line: 11,
        column: 5,
        selfSampledMicroseconds: 9,
        inclusiveSampledMicroseconds: 9,
        selfSampleCount: 1,
        inclusiveSampleCount: 1,
      },
      {
        asset: "board.js",
        functionName: "Board",
        line: 3,
        column: 4,
        selfSampledMicroseconds: 0,
        inclusiveSampledMicroseconds: 9,
        selfSampleCount: 0,
        inclusiveSampleCount: 1,
      },
    ]);
  });

  it("terminates on cycles, ignores missing nodes and does not double count an ancestor per sample", () => {
    const buckets = aggregateCpuProfileFrames([
      {
        nodes: [
          {
            id: 1,
            children: [2, 2, 99],
            functionName: "Parent",
            asset: "board.js",
            line: 1,
            column: 1,
          },
          {
            id: 2,
            children: [1],
            functionName: "Leaf",
            asset: "board.js",
            line: 2,
            column: 1,
          },
        ],
        samples: [
          { nodeId: 2, startMicroseconds: 0, durationMicroseconds: 3 },
          { nodeId: 404, startMicroseconds: 3, durationMicroseconds: 8 },
        ],
      },
    ]);

    expect(
      buckets.map(({ functionName, inclusiveSampledMicroseconds }) => [
        functionName,
        inclusiveSampledMicroseconds,
      ]),
    ).toEqual([
      ["Leaf", 3],
      ["Parent", 3],
    ]);
  });

  it("keeps unresolved runtime frames out of safe asset buckets", () => {
    const buckets = aggregateCpuProfileFrames([
      {
        nodes: [
          {
            id: 1,
            functionName: "runtime",
            asset: "runtime",
            line: 0,
            column: 0,
          },
        ],
        samples: [{ nodeId: 1, startMicroseconds: 0, durationMicroseconds: 4 }],
      },
    ]);

    expect(buckets).toEqual([]);
  });
});
