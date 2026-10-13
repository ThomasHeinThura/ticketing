import { HttpError } from "@/lib/http-error";

/**
 * Compares two `numeric(20,10)` positions as the API serialises them (decimal strings),
 * without going through `Number` so that long fractions keep their order (`WI-11`).
 */
export function comparePosition(left: string, right: string): number {
  const parse = (raw: string) => {
    const negative = raw.startsWith("-");
    const value = negative ? raw.slice(1) : raw;
    const [whole = "0", fraction = ""] = value.split(".");
    return {
      negative,
      whole: whole.replace(/^0+(?=\d)/, ""),
      fraction: fraction.padEnd(10, "0"),
    };
  };
  const a = parse(left);
  const b = parse(right);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const wholeOrder =
    a.whole.length - b.whole.length || a.whole.localeCompare(b.whole);
  const fractionOrder = a.fraction.localeCompare(b.fraction);
  const order = wholeOrder || fractionOrder;
  return a.negative ? -order : order;
}

type Ranked = { id: string; position: string };

/** One column's items in rank order (position, then id as the stable tie-break). */
export function sortByRank<T extends Ranked>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      comparePosition(a.position, b.position) || a.id.localeCompare(b.id),
  );
}

/**
 * The `beforeId`/`afterId` pair for `POST /work-items/{key}/rank` that places `movedId` at
 * `targetIndex` of its own column once it has been taken out of it. `beforeId` is the item
 * that ends up immediately before the new slot and `afterId` the one immediately after it.
 * Sending both neighbours lets the server pick the midpoint instead of an end-of-list
 * offset that could collide with the next item. Returns `undefined` when the move is a
 * no-op or `movedId` is not in the column.
 */
export function rankNeighbours(
  column: readonly Ranked[],
  movedId: string,
  targetIndex: number,
): { beforeId?: string; afterId?: string } | undefined {
  const from = column.findIndex((item) => item.id === movedId);
  if (from === -1) return undefined;
  const without = column.filter((item) => item.id !== movedId);
  const to = Math.max(0, Math.min(targetIndex, without.length));
  if (to === from) return undefined;
  const before = without[to - 1];
  const after = without[to];
  if (!before && !after) return undefined;
  return {
    ...(before ? { beforeId: before.id } : {}),
    ...(after ? { afterId: after.id } : {}),
  };
}

/**
 * What a failed work-item write means for the caller. The server collapses "not there" and
 * "not yours" into one 404 (`WI-25`), so `gone` covers both. `conflict` is 409 (the item moved
 * on since the screen loaded), `rejected` is 422 (legal but unavailable right now),
 * `invalid` is 400 (for rank: a neighbour is no longer in the same project and state).
 */
export type WorkItemWriteFailure =
  | "gone"
  | "conflict"
  | "rejected"
  | "invalid"
  | "forbidden"
  | "unknown";

export function classifyWorkItemWriteError(
  error: unknown,
): WorkItemWriteFailure {
  if (!(error instanceof HttpError)) return "unknown";
  switch (error.status) {
    case 404:
      return "gone";
    case 409:
      return "conflict";
    case 422:
      return "rejected";
    case 400:
      return "invalid";
    case 403:
      return "forbidden";
    default:
      return "unknown";
  }
}
