/**
 * Deterministic derivations (pure): idempotency keys, chunk ids and parent-cycle detection. The chunk
 * digest formula lives in `imports/service.ts` (`importChunkDigest`) so staging and commit share it.
 */
import { createHash } from "node:crypto";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Idempotency-Key for a retried engine write (IM-8). Derived, never random: the same
 * (run, scope, ordinal, cursor) always yields the same key, so a retried chunk or link write
 * is replayed rather than duplicated. Always 64 hex chars, well inside the 200 character limit.
 */
export function deriveIdempotencyKey(input: {
  runId: string;
  scope: string;
  ordinal: number;
  cursor: string | null;
}): string {
  return sha(
    JSON.stringify([
      "import-engine/v1",
      input.runId,
      input.scope,
      input.ordinal,
      input.cursor,
    ]),
  );
}

/**
 * Chunk id for the page that starts at `cursor`: stable across retries, pauses and restarts of one
 * approved execution. `generation` (the approved dry-run digest) separates a re-execution after a
 * mapping change, which re-reads pages whose earlier chunks are already committed.
 */
export function deriveChunkId(
  runId: string,
  cursor: string | null,
  generation = "",
): string {
  return `eng-${sha(JSON.stringify([runId, cursor, generation])).slice(0, 32)}`;
}

/**
 * Parent cycles. `parents` maps a node key to its parent key (same source type). Returns the node
 * keys whose parent edge must be removed so no cycle remains. Deterministic: in each cycle the
 * member with the greatest key loses its parent edge, so a rerun breaks the same edge.
 */
export function detectParentCycles(
  parents: ReadonlyMap<string, string>,
): string[] {
  const broken = new Set<string>();
  const state = new Map<string, 1 | 2>();
  for (const start of [...parents.keys()].sort()) {
    if (state.get(start) === 2) continue;
    const path: string[] = [];
    const onPath = new Map<string, number>();
    let node: string | undefined = start;
    while (node !== undefined) {
      if (broken.has(node)) break;
      if (state.get(node) === 2) break;
      const at = onPath.get(node);
      if (at !== undefined) {
        const cycle = path.slice(at);
        broken.add(cycle.reduce((max, key) => (key > max ? key : max)));
        break;
      }
      onPath.set(node, path.length);
      path.push(node);
      state.set(node, 1);
      node = parents.get(node);
    }
    for (const key of path) state.set(key, 2);
  }
  return [...broken].sort();
}
