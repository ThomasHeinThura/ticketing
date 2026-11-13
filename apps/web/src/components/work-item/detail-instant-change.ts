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
import { workItemDetailKey } from "./work-item-save";

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

function pages(data: List | undefined): Page[] {
  if (!data) return [];
  return "pages" in data ? data.pages : [data];
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
  if (!page?.items.some((row) => row.key === key)) return data;
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
    retry: false,
    onMutate: async () => {
      const lists = client
        .getQueriesData<List>({ queryKey: ["work-items", item.projectId] })
        .filter(
          ([queryKey, data]) =>
            queryKey[2] !== "board" &&
            pages(data).some((page) =>
              page.items.some((row) => row.key === item.key),
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
          const row = page.items.find((row) => row.key === item.key);
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
      // These endpoints return a partial wire row. Apply ALL returned fields, including
      // transition side effects; the authoritative detail GET resolves display fields.
      if (response && typeof response === "object") {
        client.setQueryData<WorkItemDetailRow>(
          workItemDetailKey(item.key),
          (old) => (old ? { ...old, ...response } : old),
        );
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
