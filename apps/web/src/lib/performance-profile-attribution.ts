const MAX_SOURCE_MAP_BYTES = 5 * 1024 * 1024;
const MAX_MAPPINGS_BYTES = 4 * 1024 * 1024;
const MAX_SOURCES = 10_000;
const MAX_CALLER_DEPTH = 8;
const MAX_PROFILE_NODES = 5_000;
const MAX_PROFILE_SAMPLES = 100_000;
const SAFE_ASSET = /^[A-Za-z0-9_.-]{1,128}\.js$/;

export type ProfileSourceMap = {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  names: string[];
  mappings: string;
};

export type BoundProfileSourceMap = {
  sha256: string;
  parsed: { map: ProfileSourceMap; mappings: DecodedSegment[][] };
};

export type SafeProfileSource = {
  sourceIndex: number;
  nameIndex: number | null;
  line: number;
  column: number;
};

export type ProfileFrameNode = {
  id: number;
  parentId?: number;
  asset: string;
  line: number;
  column: number;
};

export type ProfileFrameSample = {
  nodeId: number;
  durationMicroseconds: number;
};

export type ProfiledAssetIdentity = {
  file: string;
  sha256: string;
  sourceMapSha256?: string;
};

export type SampledProfileAttribution = {
  nodeId: number;
  asset: string;
  assetSha256: string;
  sourceMapSha256: string;
  generatedLine: number;
  generatedColumn: number;
  source: SafeProfileSource | null;
  callers: Array<{
    nodeId: number;
    asset: string;
    assetSha256: string;
    sourceMapSha256: string;
    source: SafeProfileSource | null;
  }>;
  sampledMicroseconds: number;
};

type DecodedSegment = {
  generatedColumn: number;
  sourceIndex?: number;
  originalLine?: number;
  originalColumn?: number;
  nameIndex?: number;
};

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeVlq(input: string, start: number): [number, number] | null {
  let cursor = start;
  let value = 0;
  let place = 1;
  let continuation = true;
  while (continuation) {
    if (cursor >= input.length || place > Number.MAX_SAFE_INTEGER / 32)
      return null;
    const digit = BASE64.indexOf(input[cursor] ?? "");
    if (digit < 0) return null;
    cursor += 1;
    continuation = (digit & 32) !== 0;
    value += (digit & 31) * place;
    if (!Number.isSafeInteger(value)) return null;
    place *= 32;
  }
  const negative = value % 2 === 1;
  const decoded = Math.floor(value / 2);
  return [negative ? -decoded : decoded, cursor];
}

function decodeMappings(map: ProfileSourceMap): DecodedSegment[][] | null {
  if (
    map.version !== 3 ||
    !Array.isArray(map.sources) ||
    map.sources.length > MAX_SOURCES ||
    !Array.isArray(map.names) ||
    map.names.length > MAX_SOURCES ||
    typeof map.mappings !== "string" ||
    map.mappings.length > MAX_MAPPINGS_BYTES
  )
    return null;

  const lines: DecodedSegment[][] = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  for (const encodedLine of map.mappings.split(";")) {
    let generatedColumn = 0;
    const segments: DecodedSegment[] = [];
    for (const encodedSegment of encodedLine.split(",")) {
      if (!encodedSegment) continue;
      let cursor = 0;
      const fields: number[] = [];
      while (cursor < encodedSegment.length) {
        const decoded = decodeVlq(encodedSegment, cursor);
        if (!decoded) return null;
        fields.push(decoded[0]);
        cursor = decoded[1];
        if (fields.length > 5) return null;
      }
      generatedColumn += fields[0] ?? 0;
      if (
        !Number.isSafeInteger(generatedColumn) ||
        (fields[0] ?? 0) < 0 ||
        generatedColumn < 0
      )
        return null;
      if (fields.length === 1) {
        segments.push({ generatedColumn });
        continue;
      }
      if (fields.length !== 4 && fields.length !== 5) return null;
      sourceIndex += fields[1] ?? 0;
      originalLine += fields[2] ?? 0;
      originalColumn += fields[3] ?? 0;
      if (
        !Number.isSafeInteger(sourceIndex) ||
        !Number.isSafeInteger(originalLine) ||
        !Number.isSafeInteger(originalColumn) ||
        sourceIndex < 0 ||
        sourceIndex >= map.sources.length ||
        originalLine < 0 ||
        originalColumn < 0
      )
        return null;
      const segment: DecodedSegment = {
        generatedColumn,
        sourceIndex,
        originalLine,
        originalColumn,
      };
      if (fields.length === 5) {
        nameIndex += fields[4] ?? 0;
        if (
          !Number.isSafeInteger(nameIndex) ||
          nameIndex < 0 ||
          nameIndex >= map.names.length
        )
          return null;
        segment.nameIndex = nameIndex;
      }
      segments.push(segment);
    }
    lines.push(segments);
  }
  return lines;
}

export function parseProfileSourceMap(
  raw: string,
  expectedAssetBasename: string,
): { map: ProfileSourceMap; mappings: DecodedSegment[][] } | null {
  if (raw.length > MAX_SOURCE_MAP_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<ProfileSourceMap>;
  if (
    candidate.version !== 3 ||
    (candidate.file !== undefined &&
      candidate.file !== expectedAssetBasename) ||
    !Array.isArray(candidate.sources) ||
    !Array.isArray(candidate.names) ||
    typeof candidate.mappings !== "string"
  )
    return null;
  const candidateMap = candidate as ProfileSourceMap;
  const mappings = decodeMappings(candidateMap);
  if (!mappings) return null;
  const map: ProfileSourceMap = {
    version: 3,
    file: expectedAssetBasename,
    sources: candidateMap.sources.map((_, index) => `source-${index}`),
    names: candidateMap.names.map((_, index) => `name-${index}`),
    mappings: candidateMap.mappings,
  };
  return { map, mappings };
}

export function mapGeneratedPosition(
  sourceMap: { map: ProfileSourceMap; mappings: DecodedSegment[][] },
  line: number,
  column: number,
): SafeProfileSource | null {
  if (
    !Number.isSafeInteger(line) ||
    line < 1 ||
    !Number.isSafeInteger(column) ||
    column < 1
  )
    return null;
  const segments = sourceMap.mappings[line - 1];
  if (!segments) return null;
  let best: DecodedSegment | undefined;
  for (const segment of segments) {
    if (segment.generatedColumn > column - 1) break;
    best = segment;
  }
  if (
    !best ||
    best.sourceIndex === undefined ||
    best.originalLine === undefined ||
    best.originalColumn === undefined
  )
    return null;
  if (typeof sourceMap.map.sources[best.sourceIndex] !== "string") return null;
  return {
    sourceIndex: best.sourceIndex,
    nameIndex: best.nameIndex ?? null,
    line: best.originalLine + 1,
    column: best.originalColumn + 1,
  };
}

export function sampleProfileCallers(
  nodes: readonly ProfileFrameNode[],
  samples: readonly ProfileFrameSample[],
  identities: ReadonlyMap<string, ProfiledAssetIdentity>,
  sourceMaps: ReadonlyMap<string, BoundProfileSourceMap>,
): SampledProfileAttribution[] {
  if (nodes.length > MAX_PROFILE_NODES || samples.length > MAX_PROFILE_SAMPLES)
    return [];
  const nodeById = new Map<number, ProfileFrameNode>();
  for (const node of nodes) {
    if (!Number.isSafeInteger(node.id) || node.id < 0 || nodeById.has(node.id))
      return [];
    nodeById.set(node.id, node);
  }
  const parents = new Map<number, number>();
  for (const node of nodes) {
    if (
      node.parentId !== undefined &&
      Number.isSafeInteger(node.parentId) &&
      node.parentId >= 0 &&
      node.parentId !== node.id &&
      nodeById.has(node.parentId)
    )
      parents.set(node.id, node.parentId);
  }
  const cyclicNodes = new Set<number>();
  for (const startId of nodeById.keys()) {
    const path: number[] = [];
    const position = new Map<number, number>();
    let current: number | undefined = startId;
    while (current !== undefined && !position.has(current)) {
      position.set(current, path.length);
      path.push(current);
      current = parents.get(current);
    }
    if (current !== undefined) {
      const cycleStart = position.get(current);
      if (cycleStart !== undefined)
        for (const cycleId of path.slice(cycleStart)) cyclicNodes.add(cycleId);
    }
  }
  for (const cyclicId of cyclicNodes) parents.delete(cyclicId);
  const totals = new Map<number, number>();
  for (const sample of samples) {
    if (
      !nodeById.has(sample.nodeId) ||
      !Number.isFinite(sample.durationMicroseconds) ||
      sample.durationMicroseconds <= 0
    )
      continue;
    totals.set(
      sample.nodeId,
      (totals.get(sample.nodeId) ?? 0) + sample.durationMicroseconds,
    );
  }
  const result: SampledProfileAttribution[] = [];
  for (const [nodeId, sampledMicroseconds] of [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 60)) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const identity = identities.get(node.asset);
    const sourceMap = sourceMaps.get(node.asset);
    if (
      !identity?.sourceMapSha256 ||
      !SAFE_ASSET.test(node.asset) ||
      identity.file.split("/").at(-1) !== node.asset ||
      !/^[a-f0-9]{64}$/.test(identity.sha256) ||
      !/^[a-f0-9]{64}$/.test(identity.sourceMapSha256) ||
      !sourceMap ||
      sourceMap.sha256 !== identity.sourceMapSha256
    )
      continue;
    const mapFrame = (frame: ProfileFrameNode): SafeProfileSource | null => {
      const frameMap = sourceMaps.get(frame.asset);
      const frameIdentity = identities.get(frame.asset);
      return frameMap && frameIdentity?.sourceMapSha256 === frameMap.sha256
        ? mapGeneratedPosition(frameMap.parsed, frame.line, frame.column)
        : null;
    };
    const frameSource = mapFrame(node);
    const callers: SampledProfileAttribution["callers"] = [];
    const visited = new Set<number>([node.id]);
    let parentId = parents.get(node.id);
    while (parentId !== undefined && callers.length < MAX_CALLER_DEPTH) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const parent = nodeById.get(parentId);
      if (!parent) break;
      const parentIdentity = identities.get(parent.asset);
      if (
        !parentIdentity?.sourceMapSha256 ||
        !SAFE_ASSET.test(parent.asset) ||
        parentIdentity.file.split("/").at(-1) !== parent.asset ||
        !/^[a-f0-9]{64}$/.test(parentIdentity.sha256) ||
        !/^[a-f0-9]{64}$/.test(parentIdentity.sourceMapSha256)
      )
        break;
      callers.push({
        nodeId: parent.id,
        asset: parent.asset,
        assetSha256: parentIdentity.sha256,
        sourceMapSha256: parentIdentity.sourceMapSha256,
        source: mapFrame(parent),
      });
      parentId = parents.get(parentId);
    }
    result.push({
      nodeId: node.id,
      asset: node.asset,
      assetSha256: identity.sha256,
      sourceMapSha256: identity.sourceMapSha256,
      generatedLine: node.line,
      generatedColumn: node.column,
      source: frameSource,
      callers,
      sampledMicroseconds,
    });
  }
  return result;
}
