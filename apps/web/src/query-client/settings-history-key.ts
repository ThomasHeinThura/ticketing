import type { Query, QueryClient } from "@tanstack/react-query";
import type { SelfHistoryTarget } from "@/fetchers/settings/personal-history";
import type { SettingsHistoryTarget } from "@/fetchers/settings/settings-history";
import { HttpError } from "@/lib/http-error";
import { type AuditMutationMeta, historyHooks } from "./audit-invalidation";

/** Root of every History query key. */
export const SETTINGS_HISTORY_KEY = "settings-history";

export type HistoryScope =
  | { kind: "instance" }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "project"; workspaceId: string; projectId: string };

export type HistoryTarget =
  | {
      kind: "entity";
      type: SettingsHistoryTarget;
      id: string;
      scope: HistoryScope;
    }
  | {
      kind: "time-settings";
      scope: Exclude<HistoryScope, { kind: "instance" }>;
    }
  | ({ kind: "self" } & SelfHistoryTarget);

const sorted = (value: unknown): unknown =>
  value && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([key, inner]) => [key, sorted(inner)]),
      )
    : value;
export const historyTargetHash = (target: unknown) =>
  JSON.stringify(sorted(target));

// Identity epoch (every target) and read generation (one target). Both sit in the query key,
// so advancing either orphans every earlier read and its cached rows.
let epoch = 0;
const generations = new Map<string, number>();
const listeners = new Set<() => void>();
export const subscribeHistory = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const historyStamp = (hash: string) =>
  `${epoch}.${generations.get(hash) ?? 0}`;

/** Withdraw admission: advance first, then cancel and drop the old reads, then wake the panels. */
function withdraw(client: QueryClient, hashes?: ReadonlySet<string>) {
  if (hashes)
    for (const hash of hashes)
      generations.set(hash, (generations.get(hash) ?? 0) + 1);
  else epoch += 1;
  client.removeQueries({
    queryKey: [SETTINGS_HISTORY_KEY],
    predicate: (query) =>
      !hashes || hashes.has(String(query.queryKey[6] ?? "")),
  });
  for (const listener of [...listeners]) listener();
}
export const withdrawHistoryTargets = (
  client: QueryClient,
  targets: readonly unknown[],
) => withdraw(client, new Set(targets.map(historyTargetHash)));
export const withdrawAllHistory = (client: QueryClient) => withdraw(client);

export function withdrawAuditedHistory(
  client: QueryClient,
  meta: AuditMutationMeta | undefined,
  variables: unknown,
  result: unknown,
) {
  if (!meta?.audits) return;
  try {
    withdrawHistoryTargets(
      client,
      meta.audits.targets(variables as never, result as never),
    );
  } catch {
    // The write is committed: a resolver bug must not fail it, so withdraw everything.
    withdrawAllHistory(client);
  }
}

/** A refusal from any other query may mean the reach changed: History must prove itself again. */
export function withdrawHistoryOnRefusal(
  client: QueryClient,
  query: Pick<Query, "queryKey">,
  error: unknown,
) {
  if (
    query.queryKey[0] !== SETTINGS_HISTORY_KEY &&
    error instanceof HttpError &&
    (error.status === 403 || error.status === 404)
  )
    withdrawAllHistory(client);
}

historyHooks.onMutation = withdrawAuditedHistory;
historyHooks.onRefusal = withdrawHistoryOnRefusal;
