import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import updateWorkItem, {
  type UpdateWorkItemInput,
} from "@/fetchers/work-item/update-work-item";
import {
  beginPendingWorkItem,
  endPendingWorkItem,
  pendingWorkItemFields,
} from "@/lib/work-item-pending";
import {
  parseWorkItemDetailRow,
  type WorkItemDetail,
  type WorkItemDetailRow,
} from "@/types/work-item";

export type WorkItemFieldChange = Omit<UpdateWorkItemInput, "key" | "version">;

export function workItemDetailKey(key: string) {
  return ["work-items", "detail", key] as const;
}

/** The mutation scope every write to one item shares: TanStack runs a scope serially, so
 * a second save starts only once the first has answered and its version is known. */
export function workItemMutationScope(key: string) {
  return { id: `work-item:${key}` };
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

/**
 * Writes what a mutation response says about the item into the detail cache. PATCH,
 * transition and assign each answer with part of the item (always its new `version`), not
 * the detail row, so only the named fields are merged and the row is revalidated.
 */
export function writeWorkItemResponse(
  queryClient: QueryClient,
  key: string,
  response: unknown,
  fields: Partial<WorkItemDetail>,
) {
  if (!response || typeof response !== "object") return;
  const version = (response as { version?: unknown }).version;
  if (typeof version !== "number") return;
  raiseVersionFloor(queryClient, key, version);
  queryClient.setQueryData<WorkItemDetailRow>(workItemDetailKey(key), (old) =>
    old
      ? parseWorkItemDetailRow({
          ...old,
          ...fields,
          version: Math.max(old.version, version),
        } as WorkItemDetail)
      : old,
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

/** What `writeOptimisticWorkItemFields` changed, so a refusal can put exactly that back. */
export type OptimisticWorkItemWrite = {
  fields: Partial<WorkItemDetail>;
  token: symbol;
  /** The detail row's values for `fields` before the write. */
  detail: Partial<WorkItemDetail> | null;
  /** The cached list rows written, with their values for `fields` before the write. */
  lists: Array<{ queryKey: QueryKey; previous: CachedRow }>;
};

function pickFields(row: object, fields: object): CachedRow {
  return Object.fromEntries(
    Object.keys(fields).map((name) => [name, (row as CachedRow)[name]]),
  );
}

/** True while the row still holds the optimistic values, i.e. no reload or event replaced them. */
function stillHoldsFields(row: object, fields: object) {
  return Object.entries(fields).every(([name, value]) =>
    isSameJson((row as CachedRow)[name], value),
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

/**
 * Shows a chosen value at once (`onMutate` of the state and assignee changes). In-flight
 * reads of the item are cancelled first so a stale answer cannot land over the new value;
 * the value is written into the detail row and into the project's cached lists that hold
 * the item (the board groups cards itself and is left to its own drag-and-drop code).
 * The server still decides: its answer replaces this on success, and
 * `rollbackOptimisticWorkItemFields` undoes it on refusal.
 */
export async function writeOptimisticWorkItemFields(
  queryClient: QueryClient,
  item: Pick<WorkItemDetailRow, "key" | "projectId">,
  fields: Partial<WorkItemDetail>,
): Promise<OptimisticWorkItemWrite> {
  const token = beginPendingWorkItem(queryClient, item.key, fields);
  const detailKey = workItemDetailKey(item.key);
  const lists = listQueriesShowing(queryClient, item).filter(
    ({ queryKey }) => queryKey[2] !== "board" && queryKey[2] !== "combined",
  );
  await Promise.all([
    queryClient.cancelQueries({ queryKey: detailKey }),
    ...lists.map(({ queryKey }) =>
      queryClient.cancelQueries({ queryKey, exact: true }),
    ),
  ]);
  const previous = queryClient.getQueryData<WorkItemDetailRow>(detailKey);
  queryClient.setQueryData<WorkItemDetailRow>(detailKey, (old) =>
    old ? parseWorkItemDetailRow({ ...old, ...fields } as WorkItemDetail) : old,
  );
  const written: OptimisticWorkItemWrite["lists"] = [];
  for (const { queryKey } of lists) {
    const data = queryClient.getQueryData(queryKey);
    if (!isListData(data)) continue;
    let before: CachedRow | undefined;
    queryClient.setQueryData(
      queryKey,
      mapItemRows(data, item.key, (row) => {
        before ??= pickFields(row, fields);
        return { ...row, ...fields };
      }),
    );
    if (before) written.push({ queryKey, previous: before });
  }
  return {
    fields,
    token,
    detail: previous ? pickFields(previous, fields) : null,
    lists: written,
  };
}

/**
 * Undoes `writeOptimisticWorkItemFields` after the server refused the change. Only the
 * fields that were written go back, and only where they still hold the optimistic value:
 * a reload or realtime event that already brought the server's value is never overwritten.
 */
export function rollbackOptimisticWorkItemFields(
  queryClient: QueryClient,
  item: Pick<WorkItemDetailRow, "key">,
  write: OptimisticWorkItemWrite,
) {
  endPendingWorkItem(queryClient, item.key, write.token);
  const pending = pendingWorkItemFields(queryClient, item.key);
  const fields = Object.fromEntries(
    Object.entries(write.fields).filter(([name]) => !(name in pending)),
  );
  const detail = write.detail && pickFields(write.detail, fields);
  const lists = write.lists;
  if (detail && Object.keys(fields).length) {
    queryClient.setQueryData<WorkItemDetailRow>(
      workItemDetailKey(item.key),
      (old) =>
        old && stillHoldsFields(old, fields)
          ? parseWorkItemDetailRow({ ...old, ...detail } as WorkItemDetail)
          : old,
    );
  }
  for (const { queryKey, previous } of lists) {
    queryClient.setQueryData(queryKey, (data: unknown) =>
      Object.keys(fields).length && isListData(data)
        ? mapItemRows(data, item.key, (row) =>
            stillHoldsFields(row, fields)
              ? { ...row, ...pickFields(previous, fields) }
              : row,
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
      void refresh();
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
