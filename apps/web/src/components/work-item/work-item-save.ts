import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import updateWorkItem, {
  type UpdateWorkItemInput,
} from "@/fetchers/work-item/update-work-item";
import {
  parseWorkItemDetailRow,
  type WorkItemDetail,
  type WorkItemDetailRow,
} from "@/types/work-item";

export type WorkItemFieldChange = Omit<UpdateWorkItemInput, "key" | "version">;

export function workItemDetailKey(key: string) {
  return ["work-items", "detail", key] as const;
}

export function workItemMutationKey(key: string) {
  return ["work-items", "mutate", key] as const;
}

/** The mutation scope every write to one item shares: TanStack runs a scope serially, so
 * a second save starts only once the first has answered and its version is known. */
export function workItemMutationScope(key: string) {
  return { id: `work-item:${key}` };
}

export function isWorkItemMutating(queryClient: QueryClient, key: string) {
  return queryClient.isMutating({ mutationKey: workItemMutationKey(key) }) > 0;
}

/**
 * Runs `refresh` once this mutation finishes dispatching its terminal state, and only when
 * no other mutation for the same item is still pending or queued. `options.onSettled` runs
 * right before TanStack Query transitions `status` out of `"pending"`, so `MutationCache`
 * is observed for that exact transition before checking `queryClient.isMutating`.
 */
export function settleWorkItemMutation(
  queryClient: QueryClient,
  key: string,
  refresh: () => unknown,
  { waitUntilIdle = false }: { waitUntilIdle?: boolean } = {},
) {
  const mutationKey = workItemMutationKey(key);
  const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      (event.action.type === "success" || event.action.type === "error") &&
      event.mutation.options.mutationKey?.[0] === mutationKey[0] &&
      event.mutation.options.mutationKey?.[1] === mutationKey[1] &&
      event.mutation.options.mutationKey?.[2] === mutationKey[2]
    ) {
      const idle = queryClient.isMutating({ mutationKey }) === 0;
      if (idle || !waitUntilIdle) unsubscribe();
      if (idle) void refresh();
    }
  });
}

// The highest version a write response has reported, per client and item. A refetch that
// was already in flight when a save landed can briefly put the older version back in the
// cache; the next save must still assert the newer one, or it 409s against itself.
const versionFloors = new WeakMap<QueryClient, Map<string, number>>();

function versionFloor(queryClient: QueryClient, key: string) {
  return versionFloors.get(queryClient)?.get(key);
}

function raiseVersionFloor(
  queryClient: QueryClient,
  key: string,
  version: number,
) {
  let floors = versionFloors.get(queryClient);
  if (!floors) {
    floors = new Map();
    versionFloors.set(queryClient, floors);
  }
  floors.set(key, Math.max(floors.get(key) ?? 0, version));
}

/** The version to assert now: read at mutation time from the cache (and the floor above),
 * never from the render that scheduled the save. */
export function currentWorkItemVersion(
  queryClient: QueryClient,
  item: Pick<WorkItemDetailRow, "key" | "version">,
) {
  const cached = queryClient.getQueryData<WorkItemDetailRow>(
    workItemDetailKey(item.key),
  );
  return Math.max(
    cached?.version ?? 0,
    item.version,
    versionFloor(queryClient, item.key) ?? 0,
  );
}

export function cachedWorkItem(
  queryClient: QueryClient,
  item: WorkItemDetailRow,
) {
  return (
    queryClient.getQueryData<WorkItemDetailRow>(workItemDetailKey(item.key)) ??
    item
  );
}

type CachedRow = Record<string, unknown>;
type ListData = { pages: Array<{ items: CachedRow[] }> };

/** A cached list read (`useInfiniteQuery` pages of `{ items }`); the project's other reads
 * (schedule, hierarchy) have another shape and never match. */
function isListData(data: unknown): data is ListData {
  const pages = (data as { pages?: unknown } | undefined)?.pages;
  return (
    Array.isArray(pages) &&
    pages.every((page) =>
      Array.isArray((page as { items?: unknown } | null)?.items),
    )
  );
}

function mapItemRows(
  data: ListData,
  key: string,
  update: (row: CachedRow) => CachedRow,
): ListData {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((row) => (row.key === key ? update(row) : row)),
    })),
  };
}

/** The project's cached list reads that currently hold the item. */
function listQueriesShowing(
  queryClient: QueryClient,
  item: Pick<WorkItemDetailRow, "key" | "projectId">,
) {
  return queryClient.getQueryCache().findAll({
    queryKey: ["work-items", item.projectId],
    predicate: ({ state }) =>
      isListData(state.data) &&
      state.data.pages.some((page) =>
        page.items.some((row) => row.key === item.key),
      ),
  });
}

/** Cached non-board list reads showing the item (board drag-and-drop owns its own cache). */
function editableListQueriesShowing(
  queryClient: QueryClient,
  item: Pick<WorkItemDetailRow, "key" | "projectId">,
) {
  return listQueriesShowing(queryClient, item).filter(
    ({ queryKey }) => queryKey[2] !== "board" && queryKey[2] !== "combined",
  );
}

function editableListQueriesWithKey(queryClient: QueryClient, key: string) {
  return queryClient.getQueryCache().findAll({
    queryKey: ["work-items"],
    predicate: ({ queryKey, state }) =>
      queryKey[2] !== "board" &&
      queryKey[2] !== "combined" &&
      isListData(state.data) &&
      state.data.pages.some((page) =>
        page.items.some((row) => row.key === key),
      ),
  });
}

function mergeDetailFields(
  old: WorkItemDetailRow,
  patch: Partial<WorkItemDetail>,
): WorkItemDetailRow {
  const merged = { ...old, ...patch };
  return typeof old.number === "number"
    ? parseWorkItemDetailRow(merged as WorkItemDetail)
    : merged;
}

/**
 * Preserves any row in an incoming list page that either has an optimistic mutation in
 * flight or already holds a newer version in the cached list than an out-of-order read.
 */
export function mergeWorkItemListPage(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  page: WorkItemsResult,
): WorkItemsResult {
  const existing = queryClient.getQueryData(queryKey);
  if (!isListData(existing)) return page;
  const prevByKey = new Map<string, CachedRow>();
  for (const prevPage of existing.pages) {
    for (const row of prevPage.items) {
      if (typeof row.key === "string") prevByKey.set(row.key, row);
    }
  }
  return {
    ...page,
    items: page.items.map((row) => {
      const prev = prevByKey.get(row.key);
      if (!prev) return row;
      if (isWorkItemMutating(queryClient, row.key)) {
        return prev as unknown as typeof row;
      }
      if (
        typeof prev.version === "number" &&
        typeof row.version === "number" &&
        prev.version > row.version
      ) {
        return prev as unknown as typeof row;
      }
      return row;
    }),
  };
}

/**
 * Writes what a mutation response says about the item into the detail cache (and matching
 * non-board list rows). When `expectedOptimistic` is supplied, fields already superseded by
 * a later queued mutation on the same field are left at the newer optimistic value while
 * still advancing `version`.
 */
export function writeWorkItemResponse(
  queryClient: QueryClient,
  key: string,
  response: unknown,
  fields: Partial<WorkItemDetail>,
  expectedOptimistic?: Partial<WorkItemDetail>,
) {
  if (!response || typeof response !== "object") return;
  const version = (response as { version?: unknown }).version;
  if (typeof version !== "number") return;
  raiseVersionFloor(queryClient, key, version);
  const canApply = (row: CachedRow) =>
    !expectedOptimistic ||
    Object.entries(expectedOptimistic).every(([field, written]) =>
      isSameJson(row[field], written),
    );
  queryClient.setQueryData<WorkItemDetailRow>(workItemDetailKey(key), (old) => {
    if (!old) return old;
    const nextVersion = Math.max(old.version, version);
    const patch = canApply(old as unknown as CachedRow)
      ? { ...fields, version: nextVersion }
      : { version: nextVersion };
    return mergeDetailFields(old, patch);
  });
  for (const { queryKey } of editableListQueriesWithKey(queryClient, key)) {
    queryClient.setQueryData(queryKey, (data: unknown) =>
      isListData(data)
        ? mapItemRows(data, key, (row) => {
            const nextVersion =
              typeof row.version === "number"
                ? Math.max(row.version, version)
                : version;
            return canApply(row)
              ? { ...row, ...fields, version: nextVersion }
              : { ...row, version: nextVersion };
          })
        : data,
    );
  }
}

/**
 * The item's queries a change must refresh (detail, activity, transitions, SLA, lists).
 *
 * `narrow` is for a change that only moves this item's own state or assignee: the
 * project's lists are then refreshed only where they show the item (a list that gains it
 * is refreshed by the realtime event, or the next poll), and the labels are left alone.
 */
export function useRefreshWorkItem(
  item: WorkItemDetailRow,
  { narrow = false }: { narrow?: boolean } = {},
) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: workItemDetailKey(item.key) }),
      queryClient.invalidateQueries({
        queryKey: ["work-items", "activity", item.key],
      }),
      queryClient.invalidateQueries({
        queryKey: ["work-items", "transitions", item.key],
      }),
      queryClient.invalidateQueries({
        queryKey: ["work-items", "sla", item.key],
      }),
      ...(narrow
        ? listQueriesShowing(queryClient, item).map(({ queryKey }) =>
            queryClient.invalidateQueries({ queryKey, exact: true }),
          )
        : [
            queryClient.invalidateQueries({
              queryKey: ["work-items", item.projectId],
            }),
            queryClient.invalidateQueries({
              queryKey: ["labels", item.workspaceId, "work-items", item.key],
            }),
          ]),
    ]);
}

/** One mutation's optimistic write and the single field-scoped snapshot taken in `onMutate`. */
export type OptimisticWorkItemSnapshot = {
  optimistic: Partial<WorkItemDetail>;
  previous: Partial<WorkItemDetail>;
};

function isOptimisticSnapshot(
  value: unknown,
): value is OptimisticWorkItemSnapshot {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    "optimistic" in (value as object) &&
    "previous" in (value as object)
  );
}

/**
 * Cancels in-flight reads of the item, snapshots the written fields from the cached detail
 * row, and writes the chosen values into the cached detail and matching non-board project
 * list rows synchronously so the new value shows at once.
 */
export function applyOptimisticWorkItemFields(
  queryClient: QueryClient,
  item: WorkItemDetailRow,
  optimistic: Partial<WorkItemDetail>,
): OptimisticWorkItemSnapshot {
  const detailKey = workItemDetailKey(item.key);
  const lists = editableListQueriesShowing(queryClient, item);
  void queryClient.cancelQueries({ queryKey: detailKey });
  for (const { queryKey } of lists) {
    void queryClient.cancelQueries({ queryKey, exact: true });
  }
  const current =
    queryClient.getQueryData<WorkItemDetailRow>(detailKey) ?? item;
  const previous: Partial<WorkItemDetail> = {};
  for (const field of Object.keys(optimistic) as Array<keyof WorkItemDetail>) {
    (previous as CachedRow)[field] = (current as unknown as CachedRow)[field];
  }
  queryClient.setQueryData<WorkItemDetailRow>(detailKey, (old) =>
    old ? mergeDetailFields(old, optimistic) : old,
  );
  for (const { queryKey } of lists) {
    queryClient.setQueryData(queryKey, (data: unknown) =>
      isListData(data)
        ? mapItemRows(data, item.key, (row) => ({ ...row, ...optimistic }))
        : data,
    );
  }
  return { optimistic, previous };
}

function matchesOptimistic(
  row: CachedRow,
  optimistic: Partial<WorkItemDetail>,
): boolean {
  return Object.entries(optimistic).every(([field, written]) =>
    isSameJson(row[field], written),
  );
}

function restoreSnapshotFields<T extends CachedRow>(
  row: T,
  snapshot: OptimisticWorkItemSnapshot,
): T {
  if (!matchesOptimistic(row, snapshot.optimistic)) return row;
  const next: CachedRow = { ...row };
  for (const field of Object.keys(snapshot.optimistic)) {
    next[field] = (snapshot.previous as CachedRow)[field];
  }
  return next as T;
}

/**
 * Restores from this mutation's snapshot only when the cached field still holds what this
 * mutation wrote. If a queued mutation snapshotted this failed mutation's unconfirmed value
 * while it was in flight, its snapshot is rebased to `previous` so consecutive refusals still
 * roll back to the last confirmed value.
 */
export function rollbackOptimisticWorkItemFields(
  queryClient: QueryClient,
  item: Pick<WorkItemDetailRow, "key" | "projectId">,
  snapshot: OptimisticWorkItemSnapshot,
) {
  for (const pending of queryClient.getMutationCache().findAll({
    mutationKey: workItemMutationKey(item.key),
    status: "pending",
  })) {
    const queued = pending.state.context;
    if (!isOptimisticSnapshot(queued) || queued === snapshot) continue;
    const queuedPrev = queued.previous as CachedRow;
    if (
      Object.keys(snapshot.optimistic).every((field) => field in queuedPrev) &&
      matchesOptimistic(queuedPrev, snapshot.optimistic)
    ) {
      for (const field of Object.keys(snapshot.optimistic)) {
        queuedPrev[field] = (snapshot.previous as CachedRow)[field];
      }
    }
  }
  queryClient.setQueryData<WorkItemDetailRow>(
    workItemDetailKey(item.key),
    (old) => {
      if (!old) return old;
      const restored = restoreSnapshotFields(
        old as unknown as CachedRow,
        snapshot,
      ) as unknown as WorkItemDetailRow;
      return restored === old ? old : mergeDetailFields(restored, {});
    },
  );
  for (const { queryKey } of editableListQueriesShowing(queryClient, item)) {
    queryClient.setQueryData(queryKey, (data: unknown) =>
      isListData(data)
        ? mapItemRows(data, item.key, (row) =>
            restoreSnapshotFields(row, snapshot),
          )
        : data,
    );
  }
}

const PATCH_FIELDS = [
  "title",
  "description",
  "priority",
  "startDate",
  "dueDate",
  "requesterId",
  "updatedAt",
] as const;

/**
 * Saves a partial change with the item's current version (`If-Match`). Failures are left
 * to the caller (`onError`), because the title, the description and the property rows
 * each show them differently.
 */
export function useSaveWorkItemFields(
  item: WorkItemDetailRow,
  {
    onSuccess,
    onError,
    onSettled,
  }: {
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
    /** Runs for every save, even after the caller unmounted, with what was sent. */
    onSettled?: (fields: WorkItemFieldChange) => void;
  } = {},
) {
  const queryClient = useQueryClient();
  const refresh = useRefreshWorkItem(item);
  return useMutation({
    scope: workItemMutationScope(item.key),
    mutationFn: async (fields: WorkItemFieldChange) => {
      const updated = await updateWorkItem({
        key: item.key,
        version: currentWorkItemVersion(queryClient, item),
        ...fields,
      });
      const merged: Record<string, unknown> = {};
      for (const field of PATCH_FIELDS) {
        if (
          updated &&
          typeof updated === "object" &&
          field in (updated as object)
        ) {
          merged[field] = (updated as Record<string, unknown>)[field];
        }
      }
      writeWorkItemResponse(queryClient, item.key, updated, merged);
      return updated;
    },
    onSuccess: () => {
      onSuccess?.();
      if (!isWorkItemMutating(queryClient, item.key)) {
        void refresh();
      } else {
        settleWorkItemMutation(queryClient, item.key, refresh, {
          waitUntilIdle: true,
        });
      }
    },
    onError,
    onSettled: (_data, _error, fields) => onSettled?.(fields),
  });
}

/** Structural equality for JSON values that ignores object key order: Postgres `jsonb`
 * does not keep the order a document was written in. */
export function isSameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((entry, i) => isSameJson(entry, b[i]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  // An undefined property is absent once serialised, so it is ignored on both sides.
  const keys = (value: Record<string, unknown>) =>
    Object.keys(value).filter((key) => value[key] !== undefined);
  const leftKeys = keys(left);
  const rightKeys = keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.hasOwn(right, key) && isSameJson(left[key], right[key]),
    )
  );
}
