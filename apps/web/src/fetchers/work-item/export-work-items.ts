import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import type {
  WorkItemSearchColumn,
  WorkItemSortDirection,
  WorkItemSortField,
} from "@/lib/routes";
import { parseFilterTextOrThrow, toSearchSort } from "./search-work-items";

const DEFAULT_COLUMNS: WorkItemSearchColumn[] = [
  "key",
  "title",
  "state",
  "assignee",
  "priority",
  "dueDate",
];

export async function exportWorkItems(input: {
  workspaceId: string;
  projectSlug: string;
  filter?: string;
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  columns?: WorkItemSearchColumn[];
}): Promise<string> {
  const filter = input.filter?.trim()
    ? parseFilterTextOrThrow(input.filter)
    : undefined;
  const projectFilter = {
    field: "project",
    op: "eq",
    value: input.projectSlug,
  } as const;
  const scopedFilter = filter
    ? { op: "and" as const, clauses: [projectFilter, filter] }
    : projectFilter;
  const sort = toSearchSort(input.sort, input.dir);
  const response = await client["work-items"].export.$post({
    json: {
      workspaceId: input.workspaceId,
      query: {
        entity: "work_item",
        filter: scopedFilter,
        ...(sort.length > 0 ? { sort } : {}),
        columns: input.columns ?? DEFAULT_COLUMNS,
      },
    },
  });
  if (!response.ok) {
    let detail = "Failed to export work items";
    try {
      const body = (await response.json()) as {
        message?: unknown;
        code?: unknown;
      };
      if (typeof body.message === "string" && body.message.trim().length > 0) {
        detail = body.message.trim();
      }
    } catch {
      // Non-JSON error response
    }
    throw new HttpError(response.status, detail);
  }
  return response.text();
}
