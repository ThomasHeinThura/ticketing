import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import {
  parseFilterTextOrThrow,
  postWorkItemSearch,
  type StructuredWorkItemsResult,
} from "@/fetchers/work-item/search-work-items";
import { HttpError } from "@/lib/http-error";
import type { SavedViewUrlSearch } from "@/lib/routes";
import { type SavedViewLayout, savedViewSort } from "@/lib/saved-view-query";
import { parseWorkItemRow } from "@/types/work-item";

const views = client.views;

export type SavedView = InferResponseType<typeof views.$get, 200>[number];
export type SavedViewRecord = InferResponseType<
  (typeof views)[":id"]["$get"],
  200
>;
export type ShareableViewTeam = InferResponseType<
  (typeof views)["team-audiences"]["$get"],
  200
>["data"][number];
export type SavedViewVisibility = "private" | "team" | "workspace";
export type SavedViewScope = "workspace" | "project";

export async function getSavedViews(workspaceId: string): Promise<SavedView[]> {
  const response = await views.$get({ query: { workspaceId } });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to load saved views");
  return response.json();
}

export async function getSavedView(id: string): Promise<SavedViewRecord> {
  const response = await views[":id"].$get({ param: { id } });
  if (!response.ok) throw new HttpError(response.status, "Unable to load view");
  return response.json();
}

export async function getShareableViewTeams(
  workspaceId: string,
): Promise<ShareableViewTeam[]> {
  const response = await views["team-audiences"].$get({
    query: { workspaceId },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to load shareable teams");
  return (await response.json()).data;
}

/** `POST /api/views/{id}/run`: the stored view, executed for the current viewer. */
export async function runSavedView(input: {
  id: string;
  limit?: number;
  cursor?: string;
}): Promise<StructuredWorkItemsResult> {
  const response = await views[":id"].run.$post({
    param: { id: input.id },
    query: {
      ...(input.limit ? { limit: String(input.limit) } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    },
  });
  if (!response.ok) throw new HttpError(response.status, "Unable to run view");
  const { data, page, meta } = await response.json();
  const items = data.map(parseWorkItemRow);
  return {
    items,
    hasPartialFailure: items.some((item) => item.unavailableFields.length > 0),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    total: meta?.total,
  };
}

/** `GET /api/views/{id}/count`: reachable matches for this viewer (cached 30 s server-side). */
export async function countSavedView(id: string): Promise<number> {
  const response = await views[":id"].count.$get({ param: { id } });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to count view");
  return (await response.json()).count;
}

/** Toggles the caller's own pin (`SV-20`); answers with their pinned ids in this workspace. */
export async function toggleSavedViewPin(id: string) {
  const response = await views[":id"].pin.$post({ param: { id } });
  if (!response.ok) throw new HttpError(response.status, "Unable to pin view");
  return response.json();
}

export async function createSavedView(input: {
  workspaceId: string;
  name: string;
  scope: SavedViewScope;
  scopeId: string;
  visibility?: SavedViewVisibility;
  sharedWithTeamId?: string;
  layout: SavedViewLayout;
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
  visibility?: SavedViewVisibility;
  layout?: SavedViewLayout;
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

/**
 * Deleting a saved view is a request, not a delete (`DELETE /api/views/{id}` -> `202` and a
 * pending action the requester approves in a browser session). Nothing is removed here.
 */
export async function requestSavedViewDeletion(id: string) {
  const response = await views[":id"].$delete({ param: { id } });
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Unable to request saved view deletion",
    );
  return (await response.json()) as { pendingActionId: string };
}

/**
 * Runs the definition a URL carries as the current viewer (`SV-19`), through the same
 * work-item search a saved view's own run uses, so field permissions and reach are the
 * viewer's. It serves a link to a view the viewer cannot open, and a view being edited.
 * A project-scoped definition is narrowed to its project with a leading `project` clause.
 */
export async function runSavedViewUrlQuery(input: {
  workspaceId: string;
  filter?: string;
  projectSlug?: string;
  sort?: SavedViewUrlSearch["sort"];
  dir?: SavedViewUrlSearch["dir"];
  columns?: SavedViewUrlSearch["columns"];
  cursor?: string;
}): Promise<StructuredWorkItemsResult> {
  const filter = input.filter
    ? parseFilterTextOrThrow(input.filter)
    : undefined;
  const projectFilter = input.projectSlug
    ? { field: "project", op: "eq" as const, value: input.projectSlug }
    : undefined;
  const scopedFilter = projectFilter
    ? filter
      ? { op: "and" as const, clauses: [projectFilter, filter] }
      : projectFilter
    : filter;
  const sort = savedViewSort({ sort: input.sort, dir: input.dir });
  return postWorkItemSearch({
    workspaceId: input.workspaceId,
    ...(scopedFilter ? { filter: scopedFilter } : {}),
    ...(sort ? { sort: [sort] } : {}),
    ...(input.columns ? { columns: input.columns } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
  });
}
