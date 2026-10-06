import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { parseWorkItemFilterText } from "@/lib/work-item-filter";

export async function exportWorkItems(input: {
  workspaceId: string;
  projectSlug: string;
  filter: string;
  sort: "key" | "title" | "priority" | "dueDate";
  dir: "asc" | "desc";
}): Promise<string> {
  const filter = parseWorkItemFilterText(input.filter);
  const projectFilter = {
    field: "project",
    op: "eq",
    value: input.projectSlug,
  } as const;
  const scopedFilter = filter
    ? { op: "and" as const, clauses: [projectFilter, filter] }
    : projectFilter;
  const response = await client["work-items"].export.$post({
    json: {
      workspaceId: input.workspaceId,
      query: {
        entity: "work_item",
        filter: scopedFilter,
        sort: [{ field: input.sort, order: input.dir }],
        columns: ["key", "title", "state", "assignee", "priority", "dueDate"],
      },
    },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to export work items");
  return response.text();
}
