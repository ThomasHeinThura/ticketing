export type CpuProfileNode = {
  id: number;
  parent?: number;
  children?: readonly number[];
  functionName: string;
  asset: string;
  line: number;
  column: number;
};

export type RawCpuProfileNode = {
  id: number;
  parent?: number;
  children?: readonly number[];
  callFrame?: {
    functionName?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
};

export type CpuProfileSample = {
  nodeId: number;
  startMicroseconds: number;
  durationMicroseconds: number;
};

export type SanitizedCpuProfile = {
  nodes: readonly CpuProfileNode[];
  samples: readonly CpuProfileSample[];
};

export type CpuProfileBucket = {
  asset: string;
  functionName: string;
  line: number;
  column: number;
  selfSampledMicroseconds: number;
  inclusiveSampledMicroseconds: number;
  selfSampleCount: number;
  inclusiveSampleCount: number;
};

/** Keep only safe compiled coordinates from raw V8 ProfileChunk node records. */
export function sanitizeCpuProfileNodes(
  nodes: readonly RawCpuProfileNode[],
  expectedOrigin: string,
): CpuProfileNode[] {
  return nodes.map((node) => {
    let asset = "runtime";
    try {
      const frameUrl = new URL(node.callFrame?.url ?? "", expectedOrigin);
      asset =
        frameUrl.origin === expectedOrigin &&
        frameUrl.pathname.startsWith("/assets/")
          ? frameUrl.pathname.split("/").at(-1) || "runtime"
          : "non-asset";
    } catch {
      asset = "non-asset";
    }
    return {
      id: node.id,
      ...(Number.isFinite(node.parent) ? { parent: node.parent } : {}),
      children: node.children ?? [],
      functionName: (node.callFrame?.functionName ?? "(unknown)").slice(0, 160),
      asset,
      line: (node.callFrame?.lineNumber ?? -1) + 1,
      column: (node.callFrame?.columnNumber ?? -1) + 1,
    };
  });
}

/** Aggregate clipped V8 samples through the sanitized profile's child links. */
export function aggregateCpuProfileFrames(
  profiles: readonly SanitizedCpuProfile[],
  limit = 60,
): CpuProfileBucket[] {
  const totals = new Map<string, CpuProfileBucket>();

  for (const profile of profiles) {
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const parents = new Map<number, Set<number>>();
    const addParent = (childId: number, parentId: number) => {
      if (!nodes.has(childId) || !nodes.has(parentId)) return;
      const childParents = parents.get(childId) ?? new Set<number>();
      childParents.add(parentId);
      parents.set(childId, childParents);
    };
    for (const node of profile.nodes) {
      if (Number.isFinite(node.parent))
        addParent(node.id, node.parent as number);
      for (const childId of node.children ?? []) addParent(childId, node.id);
    }

    for (const sample of profile.samples) {
      const sampledNode = nodes.get(sample.nodeId);
      if (!sampledNode || sample.durationMicroseconds <= 0) continue;

      const included = new Set<number>([sampledNode.id]);
      const pending = [sampledNode.id];
      while (pending.length > 0) {
        const current = pending.pop();
        if (current === undefined) continue;
        for (const parentId of parents.get(current) ?? []) {
          if (included.has(parentId)) continue;
          included.add(parentId);
          pending.push(parentId);
        }
      }

      for (const nodeId of included) {
        const node = nodes.get(nodeId);
        if (!node || node.asset === "runtime" || node.asset === "non-asset")
          continue;
        const key = `${node.asset}:${node.functionName}:${node.line}:${node.column}`;
        const bucket = totals.get(key) ?? {
          asset: node.asset,
          functionName: node.functionName,
          line: node.line,
          column: node.column,
          selfSampledMicroseconds: 0,
          inclusiveSampledMicroseconds: 0,
          selfSampleCount: 0,
          inclusiveSampleCount: 0,
        };
        bucket.inclusiveSampledMicroseconds += sample.durationMicroseconds;
        bucket.inclusiveSampleCount += 1;
        if (nodeId === sampledNode.id) {
          bucket.selfSampledMicroseconds += sample.durationMicroseconds;
          bucket.selfSampleCount += 1;
        }
        totals.set(key, bucket);
      }
    }
  }

  return [...totals.values()]
    .sort(
      (left, right) =>
        right.inclusiveSampledMicroseconds -
          left.inclusiveSampledMicroseconds ||
        right.selfSampledMicroseconds - left.selfSampledMicroseconds,
    )
    .slice(0, Math.max(0, limit));
}
