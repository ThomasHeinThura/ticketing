import { describe, expect, it } from "vitest";
import {
  type BoundProfileSourceMap,
  mapGeneratedPosition,
  type ProfileFrameNode,
  type ProfileSourceMap,
  parseProfileSourceMap,
  sampleProfileCallers,
} from "./performance-profile-attribution";

const ASSET = "work-list.js";
const JS_SHA = "a".repeat(64);
const MAP_SHA = "b".repeat(64);

function sourceMap(overrides: Partial<ProfileSourceMap> = {}) {
  return JSON.stringify({
    version: 3,
    file: ASSET,
    sources: [
      "../../../../../private/workspace/apps/web/src/components/list.tsx",
    ],
    names: ["renderList"],
    mappings: "AAAAA",
    ...overrides,
  });
}

const identities = new Map([
  [
    ASSET,
    { file: `assets/${ASSET}`, sha256: JS_SHA, sourceMapSha256: MAP_SHA },
  ],
]);

function boundMap(
  parsed: NonNullable<ReturnType<typeof parseProfileSourceMap>>,
) {
  return new Map<string, BoundProfileSourceMap>([
    [ASSET, { sha256: MAP_SHA, parsed }],
  ]);
}

const frames: ProfileFrameNode[] = [
  {
    id: 1,
    asset: "non-asset",
    line: 1,
    column: 1,
  },
  {
    id: 2,
    parentId: 1,
    asset: ASSET,
    line: 1,
    column: 1,
  },
  {
    id: 3,
    parentId: 2,
    asset: ASSET,
    line: 1,
    column: 1,
  },
];

describe("bounded diagnostic CPU profile attribution", () => {
  it("maps a known sampled function and its real parent chain with hash binding", () => {
    const parsed = parseProfileSourceMap(sourceMap(), ASSET);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const sourceMaps = boundMap(parsed);
    const result = sampleProfileCallers(
      frames,
      [{ nodeId: 3, durationMicroseconds: 21 }],
      identities,
      sourceMaps,
    );
    expect(result).toEqual([
      {
        nodeId: 3,
        asset: ASSET,
        assetSha256: JS_SHA,
        sourceMapSha256: MAP_SHA,
        generatedLine: 1,
        generatedColumn: 1,
        source: { sourceIndex: 0, nameIndex: 0, line: 1, column: 1 },
        callers: [
          {
            nodeId: 2,
            asset: ASSET,
            assetSha256: JS_SHA,
            sourceMapSha256: MAP_SHA,
            source: { sourceIndex: 0, nameIndex: 0, line: 1, column: 1 },
          },
        ],
        sampledMicroseconds: 21,
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private/workspace");
    expect(serialized).not.toContain("components/list.tsx");
  });

  it("rejects malformed, oversized-shape and asset-mismatched source maps", () => {
    expect(parseProfileSourceMap("{broken", ASSET)).toBeNull();
    expect(parseProfileSourceMap(sourceMap({ version: 2 }), ASSET)).toBeNull();
    expect(
      parseProfileSourceMap(sourceMap({ file: "another.js" }), ASSET),
    ).toBeNull();
    expect(
      parseProfileSourceMap(sourceMap({ mappings: "AAAA?" }), ASSET),
    ).toBeNull();
    expect(
      parseProfileSourceMap(sourceMap({ mappings: "ACAA" }), ASSET),
    ).toBeNull();
  });

  it("does not carry a mapped source across an unmapped generated span", () => {
    const parsed = parseProfileSourceMap(
      sourceMap({ mappings: "AAAAA,K,GAAA;AAAAA" }),
      ASSET,
    );
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(mapGeneratedPosition(parsed, 1, 1)).toEqual({
      sourceIndex: 0,
      nameIndex: 0,
      line: 1,
      column: 1,
    });
    expect(mapGeneratedPosition(parsed, 1, 6)).toBeNull();
    expect(mapGeneratedPosition(parsed, 1, 8)).toBeNull();
    expect(mapGeneratedPosition(parsed, 1, 9)).toEqual({
      sourceIndex: 0,
      nameIndex: null,
      line: 1,
      column: 1,
    });
    expect(mapGeneratedPosition(parsed, 2, 1)).toEqual({
      sourceIndex: 0,
      nameIndex: 0,
      line: 1,
      column: 1,
    });
  });

  it("rejects non-canonical coordinates and unsafe cumulative map positions", () => {
    const parsed = parseProfileSourceMap(sourceMap(), ASSET);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(mapGeneratedPosition(parsed, 0, 1)).toBeNull();
    expect(mapGeneratedPosition(parsed, 1, 0)).toBeNull();
    expect(mapGeneratedPosition(parsed, Number.MAX_SAFE_INTEGER + 1, 1)).toBe(
      null,
    );
    expect(
      parseProfileSourceMap(sourceMap({ mappings: "/////////" }), ASSET),
    ).toBeNull();
  });

  it("does not emit source-map attribution when the map digest does not match", () => {
    const parsed = parseProfileSourceMap(sourceMap(), ASSET);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const mismatchedMap = new Map<string, BoundProfileSourceMap>([
      [ASSET, { sha256: "c".repeat(64), parsed }],
    ]);
    expect(
      sampleProfileCallers(
        frames,
        [{ nodeId: 3, durationMicroseconds: 10 }],
        identities,
        mismatchedMap,
      ),
    ).toHaveLength(0);
    expect(mapGeneratedPosition(parsed, 0, 1)).toBeNull();
  });

  it("drops cyclic and missing caller edges rather than inventing ancestry", () => {
    const parsed = parseProfileSourceMap(sourceMap(), ASSET);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const sourceMaps = boundMap(parsed);
    const callerFrame = frames[1];
    const leafFrame = frames[2];
    if (!callerFrame || !leafFrame) return;
    const cyclic: ProfileFrameNode[] = [
      { ...callerFrame, parentId: leafFrame.id },
      { ...leafFrame, parentId: callerFrame.id },
    ];
    expect(
      sampleProfileCallers(
        cyclic,
        [{ nodeId: 2, durationMicroseconds: 5 }],
        identities,
        sourceMaps,
      )[0]?.callers,
    ).toEqual([]);
    const dangling: ProfileFrameNode[] = [{ ...leafFrame, parentId: 900 }];
    expect(
      sampleProfileCallers(
        dangling,
        [{ nodeId: 3, durationMicroseconds: 5 }],
        identities,
        sourceMaps,
      )[0]?.callers,
    ).toEqual([]);
    expect(
      sampleProfileCallers(
        frames,
        [{ nodeId: 9000, durationMicroseconds: 5 }],
        identities,
        sourceMaps,
      ),
    ).toEqual([]);
  });

  it("omits untrusted bundle assets and never serializes map contents", () => {
    const parsed = parseProfileSourceMap(
      sourceMap({
        sourcesContent: ["private content must not escape"],
      } as Partial<ProfileSourceMap>),
      ASSET,
    );
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const untrusted = frames.map((node) => ({
      ...node,
      asset: "untrusted-user-bundle.js",
    }));
    const result = sampleProfileCallers(
      untrusted,
      [{ nodeId: 3, durationMicroseconds: 4 }],
      identities,
      boundMap(parsed),
    );
    expect(result).toEqual([]);
    expect(JSON.stringify(parsed.map)).not.toContain(
      "private content must not escape",
    );
    expect(JSON.stringify(result)).not.toContain("private/workspace");
  });

  it("bounds caller depth and removes arbitrary frame strings", () => {
    const parsed = parseProfileSourceMap(sourceMap(), ASSET);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const deep = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      ...(index > 0 ? { parentId: index } : {}),
      asset: ASSET,
      line: 1,
      column: 1,
    }));
    const result = sampleProfileCallers(
      deep,
      [{ nodeId: 12, durationMicroseconds: 1 }],
      identities,
      boundMap(parsed),
    );
    expect(result[0]?.callers).toHaveLength(8);
    expect(JSON.stringify(result)).not.toContain("renderList");
  });
});
