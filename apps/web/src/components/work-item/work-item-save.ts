import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
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
  item: WorkItemDetailRow,
) {
  const cached = queryClient.getQueryData<WorkItemDetailRow>(
    workItemDetailKey(item.key),
  );
  return Math.max(
    cached?.version ?? item.version,
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

/** The item's queries a change must refresh (detail, activity, transitions, lists). */
export function useRefreshWorkItem(item: WorkItemDetailRow) {
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
        queryKey: ["work-items", item.projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ["work-items", "sla"] }),
    ]);
}

const PATCH_FIELDS = [
  "title",
  "description",
  "priority",
  "startDate",
  "dueDate",
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
