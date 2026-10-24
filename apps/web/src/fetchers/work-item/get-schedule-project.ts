import { client } from "@taskdesk/libs";
import getProject from "@/fetchers/project/get-project";
import searchWorkItems from "@/fetchers/work-item/search-work-items";
import { HttpError } from "@/lib/http-error";
import type Task from "@/types/task";

/** Adapt canonical rows to Kaneo's existing calendar/timeline rendering contract. */
export async function getScheduleProject(
  projectId: string,
  workspaceId: string,
  signal?: AbortSignal,
  filter = "",
) {
  const project = await getProject({ id: projectId, workspaceId });
  let matching: Set<string> | undefined;
  if (filter.trim()) {
    matching = new Set<string>();
    const followed = new Set<string>();
    let cursor: string | undefined;
    do {
      if (signal?.aborted) throw signal.reason;
      const result = await searchWorkItems({
        workspaceId,
        projectSlug: project.slug,
        filter,
        sort: "key",
        dir: "asc",
        cursor,
      });
      for (const item of result.items) matching.add(item.key);
      if (!result.hasMore) break;
      if (!result.nextCursor || followed.has(result.nextCursor))
        throw new Error("The filtered schedule cursor did not advance");
      cursor = result.nextCursor;
      followed.add(cursor);
    } while (!signal?.aborted);
  }
  const tasks = new Map<string, Task>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const response = await client.projects[":projectId"]["work-items"].$get(
      {
        param: { projectId },
        query: {
          limit: "200",
          sort: "key",
          dir: "asc",
          ...(cursor ? { cursor } : {}),
        },
      },
      { init: { signal } },
    );
    if (!response.ok)
      throw new HttpError(
        response.status,
        "Unable to load the project schedule",
      );
    const page = await response.json();
    for (const item of page.data) {
      if (matching && !matching.has(item.key)) continue;
      tasks.set(item.key, {
        id: item.key,
        title: item.title,
        number: item.number,
        description: null,
        status: item.stateName,
        priority: item.priority,
        startDate: item.startDate,
        dueDate: item.dueDate,
        position: Number(item.position),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        version: item.version,
        userId: item.assigneeId,
        assigneeId: item.assigneeId,
        assigneeName: item.assigneeName,
        projectId: item.projectId,
        columnId: item.stateId,
        moduleId: item.moduleId ?? null,
        labels: item.labels ?? [],
      });
    }
    if (!page.page.hasMore) break;
    const next = page.page.nextCursor;
    if (!next || cursors.has(next))
      throw new Error("The schedule page cursor did not advance");
    cursors.add(next);
    cursor = next;
  } while (!signal?.aborted);
  if (signal?.aborted) throw signal.reason;
  return {
    name: project.name,
    slug: project.slug,
    columns: [{ tasks: [...tasks.values()] }],
    plannedTasks: [] as Task[],
  };
}
