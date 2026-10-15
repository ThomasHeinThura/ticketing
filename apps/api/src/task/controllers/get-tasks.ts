import { HTTPException } from "hono/http-exception";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import {
  countProjectTasks,
  findLiveProject,
  listExternalLinksForTasks,
  listLabelsForTasks,
  listProjectColumns,
  listProjectTasks,
  type TaskListFilters,
} from "../repository";

type GetTasksOptions = {
  assigneeId?: string;
  dueAfter?: string;
  dueBefore?: string;
  limit?: number;
  page?: number;
  priority?: string;
  sortBy?:
    | "createdAt"
    | "priority"
    | "dueDate"
    | "position"
    | "title"
    | "number";
  sortOrder?: "asc" | "desc";
  status?: string;
};

async function getTasks(projectId: string, options: GetTasksOptions = {}) {
  const project = await findLiveProject(projectId);

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const filters: TaskListFilters = {
    status: options.status,
    priority: options.priority,
    assigneeId: options.assigneeId,
    dueBefore: options.dueBefore,
    dueAfter: options.dueAfter,
  };

  if (options.assigneeId) {
    // S5 (Opus review of PR #307, delta round): reaches the `eq(taskTable.userId,
    // ...)` filter below unvalidated -- a NUL byte would otherwise 500 instead of
    // a clean 400.
    rejectNulByte(options.assigneeId, "assigneeId");
  }

  const usePagination = options.page != null || options.limit != null;
  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize =
    options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 50;
  const offset = (page - 1) * pageSize;

  const taskCount = await countProjectTasks(projectId, filters);

  const total = Number(taskCount?.count ?? 0);

  const paginatedTasks = await listProjectTasks(
    projectId,
    filters,
    { sortBy: options.sortBy, sortOrder: options.sortOrder },
    usePagination ? { limit: pageSize, offset } : undefined,
  );

  const taskIds = paginatedTasks.map((task) => task.id);

  const labelsData =
    taskIds.length > 0 ? await listLabelsForTasks(taskIds) : [];

  const externalLinksData =
    taskIds.length > 0 ? await listExternalLinksForTasks(taskIds) : [];

  const taskLabelsMap = new Map<
    string,
    Array<{ id: string; name: string; color: string }>
  >();
  for (const label of labelsData) {
    if (label.taskId) {
      if (!taskLabelsMap.has(label.taskId)) {
        taskLabelsMap.set(label.taskId, []);
      }
      taskLabelsMap.get(label.taskId)?.push({
        id: label.id,
        name: label.name,
        color: label.color,
      });
    }
  }

  const taskExternalLinksMap = new Map<
    string,
    Array<{
      id: string;
      taskId: string;
      resourceType: string;
      externalId: string;
      url: string;
      title: string | null;
      metadata: Record<string, unknown> | null;
      // The row is selected with `select()`, so these are present, and
      // taskExternalLinkSchema requires them. Omitting them here discarded
      // them at the type level while the response schema still demanded them
      // — a latent mismatch that only surfaced once a middleware was removed
      // and the route's response type stopped being inferred loosely.
      createdAt: Date;
      updatedAt: Date;
    }>
  >();
  for (const externalLink of externalLinksData) {
    if (!taskExternalLinksMap.has(externalLink.taskId)) {
      taskExternalLinksMap.set(externalLink.taskId, []);
    }
    taskExternalLinksMap.get(externalLink.taskId)?.push({
      ...externalLink,
      metadata: externalLink.metadata
        ? JSON.parse(externalLink.metadata)
        : null,
    });
  }

  const projectColumns = await listProjectColumns(projectId);

  const columns = projectColumns.map((column) => ({
    id: column.slug,
    slug: column.slug,
    name: column.name,
    icon: column.icon,
    isFinal: column.isFinal,
    tasks: paginatedTasks
      .filter((task) => task.status === column.slug)
      .map((task) => ({
        ...task,
        labels: taskLabelsMap.get(task.id) || [],
        externalLinks: taskExternalLinksMap.get(task.id) || [],
      })),
  }));

  const archivedTasks = paginatedTasks
    .filter((task) => task.status === "archived")
    .map((task) => ({
      ...task,
      labels: taskLabelsMap.get(task.id) || [],
      externalLinks: taskExternalLinksMap.get(task.id) || [],
    }));

  const plannedTasks = paginatedTasks
    .filter((task) => task.status === "planned")
    .map((task) => ({
      ...task,
      labels: taskLabelsMap.get(task.id) || [],
      externalLinks: taskExternalLinksMap.get(task.id) || [],
    }));

  return {
    data: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      icon: project.icon,
      description: project.description,
      workspaceId: project.workspaceId,
      columns,
      archivedTasks,
      plannedTasks,
    },
    pagination: usePagination
      ? {
          total,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        }
      : {
          total,
          page: 1,
          pageSize: total,
          totalPages: 1,
        },
  };
}

export default getTasks;
