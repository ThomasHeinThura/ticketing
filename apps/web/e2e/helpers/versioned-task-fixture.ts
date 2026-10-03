type FixtureTask = {
  id: string;
  projectId: string;
  position: number | null;
  number: number | null;
  userId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  version: number;
  [key: string]: unknown;
};

type VersionedTaskUpdate = {
  title: string;
  description: string;
  startDate?: string;
  dueDate?: string;
  priority: string;
  status: string;
  projectId: string;
  position: number;
  userId?: string;
};

type RequestLike = {
  method(): string;
  url(): string;
  headers(): Record<string, string>;
  postDataJSON(): unknown;
};

export type FixtureReply = { status: number; body: unknown };

const IF_MATCH_VERSION = /^"([1-9]\d*)"$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const TASK_PRIORITIES = new Set([
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVersionedTaskUpdate(value: unknown): value is VersionedTaskUpdate {
  if (!isRecord(value)) return false;
  return (
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    (value.startDate === undefined || typeof value.startDate === "string") &&
    (value.dueDate === undefined || typeof value.dueDate === "string") &&
    typeof value.priority === "string" &&
    typeof value.status === "string" &&
    typeof value.projectId === "string" &&
    typeof value.position === "number" &&
    Number.isFinite(value.position) &&
    (value.userId === undefined || typeof value.userId === "string")
  );
}

function taskResponse(task: FixtureTask) {
  return {
    id: task.id,
    projectId: task.projectId,
    position: task.position,
    number: task.number,
    userId: task.userId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    startDate: task.startDate,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    version: task.version,
  };
}

/**
 * Models the current full-task v2 write contract used by the legacy board:
 * exact PUT route, required quoted version, conflict response, and persisted
 * full-task response. Other paths/methods are deliberately left unhandled.
 */
export function createVersionedTaskFixture(
  initialTasks: FixtureTask[],
  {
    assignableUserIds = [],
    validStatuses = [],
  }: { assignableUserIds?: string[]; validStatuses?: string[] } = {},
) {
  const tasks = new Map(initialTasks.map((task) => [task.id, { ...task }]));
  const allowedStatuses = new Set([
    ...initialTasks.map((task) => task.status),
    ...validStatuses,
    "planned",
    "archived",
  ]);
  const validAssigneeIds = new Set(assignableUserIds);

  return {
    getTask(id: string) {
      const task = tasks.get(id);
      return task ? { ...task } : undefined;
    },

    allTasks() {
      return [...tasks.values()].map((task) => ({ ...task }));
    },

    handle(request: RequestLike): FixtureReply | undefined {
      const url = new URL(request.url());
      const match = url.pathname.match(/^\/api\/v2\/task\/([^/]+)$/);
      if (!match || request.method() !== "PUT") return undefined;

      let taskId: string;
      try {
        taskId = decodeURIComponent(match[1]);
      } catch {
        return { status: 400, body: { message: "Invalid task id" } };
      }

      const ifMatch = request.headers()["if-match"];
      const versionMatch = ifMatch?.match(IF_MATCH_VERSION);
      const assertedVersion = Number(versionMatch?.[1]);
      if (
        !versionMatch ||
        !Number.isSafeInteger(assertedVersion) ||
        assertedVersion > POSTGRES_INTEGER_MAX
      ) {
        return {
          status: 400,
          body: { message: "Invalid or missing If-Match task version" },
        };
      }

      let body: unknown;
      try {
        body = request.postDataJSON();
      } catch {
        return { status: 400, body: { message: "Invalid task update body" } };
      }
      if (!isVersionedTaskUpdate(body) || !TASK_PRIORITIES.has(body.priority)) {
        return { status: 400, body: { message: "Invalid task update body" } };
      }

      const current = tasks.get(taskId);
      if (!current) return { status: 404, body: { message: "Task not found" } };
      if (current.version !== assertedVersion) {
        return {
          status: 409,
          body: {
            message:
              `Version mismatch: expected version ${assertedVersion}, ` +
              `but the task is now at version ${current.version}`,
            assertedVersion,
            currentVersion: current.version,
          },
        };
      }

      if (body.projectId !== current.projectId) {
        return {
          status: 400,
          body: {
            message:
              "Use the task move endpoint to move tasks between projects",
          },
        };
      }
      if (!allowedStatuses.has(body.status)) {
        return {
          status: 400,
          body: { message: `Invalid status "${body.status}"` },
        };
      }
      const normalizedUserId = body.userId?.trim() || null;
      if (normalizedUserId && !validAssigneeIds.has(normalizedUserId)) {
        return { status: 400, body: { message: "Assignee is not assignable" } };
      }

      const updated: FixtureTask = {
        ...current,
        title: body.title,
        description: body.description,
        startDate: body.startDate ?? null,
        dueDate: body.dueDate ?? null,
        priority: body.priority,
        status: body.status,
        position: body.position,
        userId: normalizedUserId,
        version: current.version + 1,
      };
      tasks.set(taskId, updated);
      return { status: 200, body: taskResponse(updated) };
    },
  };
}
