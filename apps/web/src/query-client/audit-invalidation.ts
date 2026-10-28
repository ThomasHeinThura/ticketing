import type { Query, QueryClient } from "@tanstack/react-query";

/** The work-item key an invalidated query is about, `null` for "all items", `undefined` if unrelated. */
function invalidatedItemKey(query: Query): string | null | undefined {
  const [root, scope, key] = query.queryKey;
  if (root === "activities") return null; // legacy, keyed by internal task id
  if (root !== "work-items") return undefined;
  if (scope !== "activity" && scope !== "detail") return undefined;
  return typeof key === "string" ? key : null;
}

/**
 * Every work-item mutation (transition, assign, edit, comment, archive, move) already
 * invalidates the item's activity or detail query. The audit-history and reconstruction
 * queries record the same changes, so they follow those invalidations here, in one place,
 * instead of at each of the mutation sites.
 */
export function followAuditInvalidation(queryClient: QueryClient) {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "invalidate") return;
    const key = invalidatedItemKey(event.query);
    if (key === undefined) return;
    for (const scope of ["audit-history", "reconstruct"]) {
      void queryClient.invalidateQueries({
        queryKey:
          key === null ? ["work-items", scope] : ["work-items", scope, key],
      });
    }
  });
}
