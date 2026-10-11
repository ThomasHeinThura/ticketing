export type CpuProfileNode = {
  id: number;
  children?: readonly number[];
  functionName: string;
  asset: string;
  line: number;
  column: number;
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

/** Aggregate clipped V8 samples through the sanitized profile's child links. */
export function aggregateCpuProfileFrames(
  profiles: readonly SanitizedCpuProfile[],
  limit = 60,
): CpuProfileBucket[] {
  const totals = new Map<string, CpuProfileBucket>();

  for (const profile of profiles) {
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const parents = new Map<number, number[]>();
    for (const node of profile.nodes) {
      for (const childId of node.children ?? []) {
        if (!nodes.has(childId)) continue;
        const childParents = parents.get(childId) ?? [];
        childParents.push(node.id);
        parents.set(childId, childParents);
      }
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
