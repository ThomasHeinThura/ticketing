import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import type {
  WorkItemSearchColumn,
  WorkItemSortDirection,
  WorkItemSortField,
} from "@/lib/routes";
import { parseWorkItemFilterText } from "@/lib/work-item-filter";
import { parseWorkItemRow, type WorkItemRow } from "@/types/work-item";

const views = client.views;

export type SavedView = InferResponseType<typeof views.$get, 200>[number];
export type SavedViewRecord = InferResponseType<
  (typeof views)[":id"]["$get"],
  200
>;
export type SavedViewRun = InferResponseType<
  (typeof views)[":id"]["run"]["$post"],
  200
>;

export type SavedViewSearchResult = {
  items: WorkItemRow[];
  hasPartialFailure: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
};

export async function getSavedViews(workspaceId: string): Promise<SavedView[]> {
  const response = await views.$get({ query: { workspaceId } });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to load saved views");
  return response.json();
}

export async function requestSavedViewDeletion(id: string) {
  const response = await views[":id"].$delete({ param: { id } });
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Unable to request saved view deletion",
    );
  return response.json() as Promise<{ pendingActionId: string }>;
}

export async function getSavedView(id: string): Promise<SavedViewRecord> {
  const response = await views[":id"].$get({ param: { id } });
  if (!response.ok) throw new HttpError(response.status, "Unable to load view");
  return response.json();
}

export async function runSavedView(input: {
  id: string;
  limit?: number;
  cursor?: string;
}): Promise<SavedViewRun> {
  const response = await views[":id"].run.$post({
    param: { id: input.id },
    query: {
      ...(input.limit ? { limit: String(input.limit) } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    },
  });
  if (!response.ok) throw new HttpError(response.status, "Unable to run view");
  return response.json() as Promise<SavedViewRun>;
}

export async function countSavedView(id: string): Promise<number> {
  const response = await views[":id"].count.$get({ param: { id } });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to count view");
  return (await response.json()).count;
}

export async function toggleSavedViewPin(id: string) {
  const response = await views[":id"].pin.$post({ param: { id } });
  if (!response.ok) throw new HttpError(response.status, "Unable to pin view");
  return response.json();
}

export async function createSavedView(input: {
  workspaceId: string;
  name: string;
  scope: "workspace" | "project";
  scopeId: string;
  visibility?: "private" | "team" | "workspace";
  layout: "board" | "list" | "table" | "calendar" | "timeline" | "chart";
  query: Record<string, unknown>;
}) {
  const response = await views.$post({ json: input });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to create view");
  return response.json();
}

export async function updateSavedView(input: {
  id: string;
  name?: string;
  sharedWithTeamId?: string | null;
  visibility?: "private" | "team" | "workspace";
  layout?: "board" | "list" | "table" | "calendar" | "timeline" | "chart";
  query?: Record<string, unknown>;
}) {
  const response = await views[":id"].$patch({
    param: { id: input.id },
    json: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.visibility === undefined
        ? {}
        : { visibility: input.visibility }),
      ...(input.sharedWithTeamId === undefined
        ? {}
        : { sharedWithTeamId: input.sharedWithTeamId }),
      ...(input.layout === undefined ? {} : { layout: input.layout }),
      ...(input.query === undefined ? {} : { query: input.query }),
    },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to update view");
  return response.json();
}

export async function runSavedViewUrlQuery(input: {
  workspaceId: string;
  filter?: string;
  projectSlug?: string;
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  columns?: WorkItemSearchColumn[];
  cursor?: string;
}): Promise<SavedViewSearchResult> {
  const filter = input.filter
    ? parseWorkItemFilterText(input.filter)
    : undefined;
  const projectFilter = input.projectSlug
    ? { field: "project", op: "eq" as const, value: input.projectSlug }
    : undefined;
  const scopedFilter = projectFilter
    ? filter
      ? { op: "and" as const, clauses: [projectFilter, filter] }
      : projectFilter
    : filter;
  const response = await client["work-items"].search.$post({
    json: {
      workspaceId: input.workspaceId,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      query: {
        entity: "work_item",
        ...(scopedFilter ? { filter: scopedFilter } : {}),
        ...(input.sort && input.dir
          ? { sort: [{ field: input.sort, order: input.dir }] }
          : {}),
        ...(input.columns ? { columns: input.columns } : {}),
      },
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { message?: unknown }
      | undefined;
    const message =
      typeof body?.message === "string" && body.message.length <= 512
        ? body.message
        : "Unable to run saved view";
    throw new HttpError(response.status, message);
  }
  const result = await response.json();
  const items = result.data.map(parseWorkItemRow);
  return {
    items,
    hasPartialFailure: items.some((item) => item.unavailableFields.length > 0),
    hasMore: result.page.hasMore,
    nextCursor: result.page.nextCursor,
    total: result.meta.total,
  };
}
