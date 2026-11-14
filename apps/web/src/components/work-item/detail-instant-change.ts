import {
  type Mutation,
  type QueryClient,
  type QueryKey,
  useIsMutating,
} from "@tanstack/react-query";
import assignWorkItem from "@/fetchers/work-item/assign-work-item";
import transitionWorkItem from "@/fetchers/work-item/transition-work-item";
import unassignWorkItem from "@/fetchers/work-item/unassign-work-item";
import { HttpError } from "@/lib/http-error";
import type { WorkItemDetailRow } from "@/types/work-item";
import {
  workItemDetailKey,
  workItemMutationScope,
  writeWorkItemResponse,
} from "./work-item-save";

// Detail chunk only. No reads, realtime handlers or board code depend on this module.
const mutationKey = (key: string) => ["detail-instant-change", key];
const ownsWrite = (key: string) => (mutation: Mutation) =>
  (mutation.options.mutationKey?.[0] === "detail-instant-change" &&
    mutation.options.mutationKey?.[1] === key) ||
  mutation.options.scope?.id === `work-item:${key}`;

export function useDetailChangePending(key: string) {
  return useIsMutating({ predicate: ownsWrite(key) }) > 0;
}

type Fields = Partial<
  Pick<
    WorkItemDetailRow,
    | "stateId"
    | "stateName"
    | "stateCategory"
    | "assigneeId"
    | "assigneeName"
    | "assigneeActive"
    | "assigneeOnProject"
  >
>;
type Row = Record<string, unknown>;
type Page = { items: Row[] };
type List = Page | { pages: Page[] };
type Snapshot = { queryKey: QueryKey; page?: number; fields: Fields };

// Only the project list factory and useGetWorkItems' project search key are owned.
// Schedule, either board shape and future reads under the prefix are never snapshots.
function isListRead(key: QueryKey) {
  return (
    (key.length === 5 &&
      key[2] === "list" &&
      typeof key[3] === "string" &&
      typeof key[4] === "string") ||
    (key.length === 9 &&
      typeof key[2] === "string" &&
      typeof key[3] === "string" &&
      Array.isArray(key[4]) &&
      key[5] === "search" &&
      typeof key[6] === "string" &&
      typeof key[7] === "string" &&
      (key[8] === null || Array.isArray(key[8])))
  );
}

function pages(data: unknown): (Page | undefined)[] {
  if (!data || typeof data !== "object") return [];
  const entries = "pages" in data ? data.pages : [data];
  if (!Array.isArray(entries)) return [];
  // Keep page indices intact even if one page has an unexpected shape.
  return entries.map((page) => (Array.isArray(page?.items) ? page : undefined));
}

function pick(row: Row, fields: Fields): Fields {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]]));
}

function matches(row: Row, fields: Fields) {
  return Object.entries(fields).every(([key, value]) => row[key] === value);
}

function changeList(
  data: List | undefined,
  pageIndex: number,
  key: string,
  change: (row: Row) => Row,
) {
  if (!data) return data;
  const page = pages(data)[pageIndex];
  if (
    !page ||
    !Array.isArray(page.items) ||
    !page.items.some((row) => row.key === key)
  )
    return data;
  const updated = {
    ...page,
    items: page.items.map((row) => (row.key === key ? change(row) : row)),
  };
  return "pages" in data
    ? {
        ...data,
        pages: data.pages.map((old, index) =>
          index === pageIndex ? updated : old,
        ),
      }
    : updated;
}

/** Same project-prefix refresh as the train, including lists that did not show the item. */
async function refresh(client: QueryClient, item: WorkItemDetailRow) {
  await Promise.all([
    client.invalidateQueries({ queryKey: workItemDetailKey(item.key) }),
    client.invalidateQueries({ queryKey: ["work-items", item.projectId] }),
    client.invalidateQueries({
      queryKey: ["work-items", "activity", item.key],
    }),
    client.invalidateQueries({
      queryKey: ["work-items", "transitions", item.key],
    }),
    client.invalidateQueries({
      queryKey: ["labels", item.workspaceId, "work-items", item.key],
    }),
    client.invalidateQueries({ queryKey: ["work-items", "sla"] }),
  ]);
}

type Feedback = {
  onSuccess: () => void;
  onError: (error: unknown) => void;
};

/** Admission is synchronous: execute marks this mutation pending before returning.
 * A second choice is rejected, never queued. Mutation callbacks survive unmount. */
function startChange(
  client: QueryClient,
  item: WorkItemDetailRow,
  fields: Fields,
  request: () => Promise<unknown>,
  feedback: Feedback,
) {
  if (client.isMutating({ predicate: ownsWrite(item.key) })) return undefined;
  const mutation = client.getMutationCache().build(client, {
    mutationKey: mutationKey(item.key),
    scope: workItemMutationScope(item.key),
    retry: false,
    onMutate: async () => {
      const lists = client
        .getQueriesData<List>({ queryKey: ["work-items", item.projectId] })
        .filter(
          ([queryKey, data]) =>
            isListRead(queryKey) &&
            pages(data).some((page) =>
              page?.items.some((row) => row.key === item.key),
            ),
        );
      await Promise.all([
        client.cancelQueries({
          queryKey: workItemDetailKey(item.key),
          exact: true,
        }),
        ...lists.map(([queryKey]) =>
          client.cancelQueries({ queryKey, exact: true }),
        ),
      ]);
      const snapshots: Snapshot[] = [];
      const detailKey = workItemDetailKey(item.key);
      client.setQueryData<WorkItemDetailRow>(detailKey, (old) => {
        if (!old) return old;
        snapshots.push({ queryKey: detailKey, fields: pick(old, fields) });
        return { ...old, ...fields };
      });
      for (const [queryKey] of lists) {
        const loaded = client.getQueryData<List>(queryKey);
        pages(loaded).forEach((page, pageIndex) => {
          const row = page?.items.find((row) => row.key === item.key);
          if (!row) return;
          snapshots.push({
            queryKey,
            page: pageIndex,
            fields: pick(row, fields),
          });
          client.setQueryData<List>(queryKey, (old) =>
            changeList(old, pageIndex, item.key, (row) => ({
              ...row,
              ...fields,
            })),
          );
        });
      }
      return snapshots;
    },
    mutationFn: request,
    onSuccess: (response) => {
      // Reapply owned display fields after any mid-write read, then let every wire
      // field win. The train's writer also advances the version floor before scoped
      // PATCH saves are released.
      if (response && typeof response === "object") {
        writeWorkItemResponse(client, item.key, response, {
          ...fields,
          ...response,
        });
      }
      feedback.onSuccess();
    },
    onError: (error, _variables, snapshots) => {
      for (const snapshot of snapshots ?? []) {
        const restore = (row: Row) =>
          matches(row, fields) ? { ...row, ...snapshot.fields } : row;
        if (snapshot.page === undefined) {
          client.setQueryData<WorkItemDetailRow>(snapshot.queryKey, (old) =>
            old ? (restore(old) as WorkItemDetailRow) : old,
          );
        } else {
          client.setQueryData<List>(snapshot.queryKey, (old) =>
            changeList(old, snapshot.page as number, item.key, restore),
          );
        }
      }
      feedback.onError(error);
    },
    onSettled: () => refresh(client, item),
  });
  // Errors have already been reported by the mutation's own callback.
  return mutation.execute(undefined).then(
    () => true,
    () => false,
  );
}

export function startDetailStateChange(
  client: QueryClient,
  item: WorkItemDetailRow,
  input: {
    stateId: string;
    toStateTemplateId: string;
    toStateName: string;
    toStateCategory: WorkItemDetailRow["stateCategory"];
    note?: string;
  },
  feedback: Feedback,
) {
  const payload = {
    key: item.key,
    toStateTemplateId: input.toStateTemplateId,
    ...(input.note ? { note: input.note } : {}),
  };
  return startChange(
    client,
    item,
    {
      stateId: input.stateId,
      stateName: input.toStateName,
      stateCategory: input.toStateCategory,
    },
    () => transitionWorkItem(payload),
    feedback,
  );
}

export function startDetailAssigneeChange(
  client: QueryClient,
  item: WorkItemDetailRow,
  person: { personId: string; name: string | null } | null,
  holder: string | null,
  feedback: Feedback,
) {
  // Never let DELETE omit its stale-holder guard, even if a caller is defective.
  if (person === null && holder === null) return undefined;
  const payload = {
    key: item.key,
    assigneeId: person?.personId ?? "",
    expectedCurrentAssigneeId: holder,
  };
  return startChange(
    client,
    item,
    {
      assigneeId: person?.personId ?? null,
      assigneeName: person?.name ?? null,
      assigneeActive: person ? true : null,
      assigneeOnProject: person ? true : null,
    },
    () =>
      person === null
        ? unassignWorkItem(payload.key, holder)
        : assignWorkItem(payload),
    feedback,
  );
}

export function detailChangeErrorKey(
  error: unknown,
  kind: "state" | "assign" | "unassign",
) {
  const status = error instanceof HttpError ? error.status : undefined;
  if (kind === "state") {
    return status === 403
      ? "workItems:journey.transitionForbidden"
      : status === 409
        ? "workItems:journey.transitionConflict"
        : status === 422
          ? "workItems:journey.transitionUnavailable"
          : "workItems:journey.saveError";
  }
  return status === 403
    ? "workItems:journey.assignmentForbidden"
    : status === 409
      ? "workItems:journey.assignmentConflict"
      : kind === "unassign"
        ? "workItems:journey.unassignmentError"
        : "workItems:journey.assignmentError";
}
