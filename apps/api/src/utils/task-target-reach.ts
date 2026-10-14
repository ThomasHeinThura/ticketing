import { and, eq, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { callerReach } from "./caller-reach";
import { markReach } from "./reach-mark";
import { rejectNulByte } from "./reject-nul-byte";

/**
 * Project reach for routes that ACT ON A SPECIFIC TASK without addressing it by a path id the
 * work-item reach middleware can resolve: a label route whose label row is bound to a task,
 * and a label route whose body names the task. Decision 720-A (`rbac.md` § Reach): an action
 * that targets a specific task requires reach to that task's project, like every other
 * item-scoped route. Workspace-level label DEFINITIONS (no task) stay workspace-scoped, so
 * these middlewares are no-ops when no task is targeted.
 *
 * Same decision source as the other reach middleware (`caller-reach.ts`): out of reach answers
 * the route's own "not found" message, byte-identical to a missing row, and nothing is read or
 * written afterwards. The capability stays with the route's own downstream gate (the label
 * policy documents that runtime check), so adding reach changes who can REACH a task, never
 * which capability a role holds.
 */

type TaskFacts = {
  readonly id: string;
  readonly projectId: string;
  readonly workspaceId: string;
};

async function loadLiveTaskFacts(taskId: string): Promise<TaskFacts | null> {
  const [task] = await db
    .select({
      id: schema.taskTable.id,
      projectId: schema.taskTable.projectId,
      workspaceId: schema.projectTable.workspaceId,
    })
    .from(schema.taskTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.taskTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.taskTable.id, taskId),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .limit(1);
  return task ?? null;
}

async function assertTaskReach(
  c: Context,
  taskId: string,
  notFoundMessage: string,
): Promise<void> {
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const task = await loadLiveTaskFacts(taskId);
  // Reach runs BEFORE the route's capability gate (as on #712's item routes), so a missing
  // task and an unreachable one (this workspace or another tenant) must answer the identical
  // 404 here for every caller; otherwise a caller lacking the capability would see 404 for an
  // existing task and 403 for a missing one. Identity is resolved either way, so both do the
  // same work.
  const reach = await callerReach(c, userId);
  if (!task || !(await reach.reaches(task))) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(404, { message: notFoundMessage });
  }
}

async function readBodyTaskId(c: Context): Promise<string | null> {
  const raw = (await c.req.json().catch(() => ({}))) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const value = (raw as Record<string, unknown>).taskId;
  return typeof value === "string" && value !== "" ? value : null;
}

/** The task named by `body.taskId` (create a task label, attach a label to a task). */
export function requireBodyTaskReach(notFoundMessage = "Task not found") {
  return markReach(
    async (c: Context, next: Next) => {
      const taskId = await readBodyTaskId(c);
      if (taskId) {
        rejectNulByte(taskId, "Task id");
        await assertTaskReach(c, taskId, notFoundMessage);
      }
      return next();
    },
    { projectReach: true },
  );
}

/** The task a label row (addressed by the `idKey` path param) is bound to, if any. */
export function requireLabelRowTaskReach(
  idKey = "id",
  notFoundMessage = "Label not found",
) {
  return markReach(
    async (c: Context, next: Next) => {
      const id = c.req.param(idKey);
      if (id) {
        rejectNulByte(id, "Label id");
        const [label] = await db
          .select({ taskId: schema.labelTable.taskId })
          .from(schema.labelTable)
          .where(eq(schema.labelTable.id, id))
          .limit(1);
        if (label?.taskId) {
          await assertTaskReach(c, label.taskId, notFoundMessage);
        }
      }
      return next();
    },
    { projectReach: true },
  );
}
