import type { Query, QueryClient } from "@tanstack/react-query";
import type { HistoryTarget } from "./settings-history-key";

type EntityTarget = Extract<HistoryTarget, { kind: "entity" }>;
/** The one-entity target list that most `meta.audits.targets` return. */
export const auditEntity = (
  type: EntityTarget["type"],
  id: string,
  scope: EntityTarget["scope"],
): HistoryTarget[] => [{ kind: "entity", type, id, scope }];

// The controller lives in the lazy History chunk and installs these when it loads. Until then no
// History query exists, so there is nothing to withdraw and the eager graph stays small.
export const historyHooks: {
  onMutation?: (
    client: QueryClient,
    meta: AuditMutationMeta | undefined,
    variables: unknown,
    result: unknown,
  ) => void;
  onRefusal?: (
    client: QueryClient,
    query: Pick<Query, "queryKey">,
    error: unknown,
  ) => void;
} = {};

/**
 * A mutation that writes audited settings declares which History targets it changes. The global
 * MutationCache withdraws and rereads them on success, before any screen callback runs.
 * Example: `useMutation({ mutationFn, meta: { audits: { targets: (v: Vars, r: Result) => [{ ... }] } } })`.
 */
export type AuditMutationMeta = {
  audits?: {
    targets(variables: never, result: never): readonly HistoryTarget[];
  };
  [key: string]: unknown;
};
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: AuditMutationMeta;
  }
}

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
