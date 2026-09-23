import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  columnTable,
  labelTable,
  projectTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { assertAssignableUser } from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import {
  assertValidPriority,
  assertValidTaskStatus,
} from "../validate-task-fields";

type BulkOperation =
  | "updateStatus"
  | "updatePriority"
  | "updateAssignee"
  | "delete"
  | "addLabel"
  | "removeLabel"
  | "updateDueDate";

async function bulkUpdateTasks({
  taskIds,
  operation,
  value,
  userId,
  workspaceId,
}: {
  taskIds: string[];
  operation: BulkOperation;
  value?: string | null;
  userId: string;
  workspaceId: string;
}) {
  // S6 (Opus review of PR #307, delta round): `bulkUpdateTasks` has exactly one
  // caller (`task/index.ts`'s `bulkUpdateTasksRoute` handler), whose middleware
  // chain always starts with `workspaceAccess.fromTasks()` -- the only path that
  // reaches this function's caller always sets `workspaceId`. But that is an
  // invariant of today's route wiring, not of this function's signature: a future
  // re-mount without `fromTasks()` would pass `undefined` through to the `eq(...)`
  // filter below, which happens to match no row and so fails closed as a 404 --
  // correct by accident, not by design. Fail loudly instead, so a wiring mistake
  // is a 500 in the logs, not a silent 404 nobody investigates. Deliberately not a
  // 403: leaking "you'd need a capability" for an indeterminate workspace is worse
  // than an opaque 500.
  if (!workspaceId) {
    throw new HTTPException(500, {
      message: "Could not determine workspace for this request",
    });
  }

  // S1 (Opus review of PR #307, delta round; BLOCKING): the #290 follow-up round
  // deleted this membership check entirely, relying only on
  // `workspaceAccess.fromTasks()` (which lets a site-wide instance admin through
  // via `validateWorkspaceAccess`'s own bypass) and `requireBulkTaskPermission`
  // (same bypass, `require-workspace-permission.ts`'s `isInstanceAdmin` check).
  // `main` never granted an instance admin who is NOT a member of a workspace the
  // ability to bulk-mutate that workspace's tasks -- this function's own
  // membership check was the only place that authority was enforced, independent
  // of the generic instance-admin bypass every other check in the chain has. That
  // is an authority change no one recorded (CLAUDE.md: authority changes must be
  // recorded before dependent code merges). Restored here, keyed on the
  // ALREADY-VALIDATED `workspaceId` from `workspaceAccess.fromTasks()` rather than
  // re-deriving it from a second task query -- this cannot reopen the #290/#285
  // oracle: `workspaceId` is only ever a workspace `fromTasks()` has already
  // proven is reachable OR the caller's own admin bypass, and a plain 403 for
  // "you (a real person, or an admin without membership) aren't a member of a
  // workspace you can already reach" reveals nothing about any OTHER workspace or
  // row.
  const [membership] = await db
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new HTTPException(403, {
      message: "You don't have access to this workspace",
    });
  }

  // #290 follow-up (mixed-id oracle): this used to resolve tasks across ANY
  // workspace the ids happened to belong to, then group by workspace and check
  // membership itself -- repeating (and re-triggering) the exact bug
  // `workspace-access-middleware.ts`'s `fromTasks()` was fixed for: `[myTask,
  // foreignTask]` 400'd "must belong to the same workspace" (revealing the foreign
  // task exists), while `[myTask, nonexistentId]` silently 200'd with only the real
  // task acted on. `fromTasks()` has already resolved and reach-checked a single
  // workspace before this controller ever runs (`c.get("workspaceId")`, set by the
  // middleware) -- filtering to it here, in the same query, means a task id that
  // is either nonexistent OR in a workspace the caller can't reach is silently
  // absent from `tasks`, exactly the same as before: no second resolution, and no
  // way for the two cases to answer differently. (The membership check just above
  // is a DIFFERENT, orthogonal check -- "is this caller a member of the one
  // workspace already proven reachable", never "which workspace do these ids
  // belong to".)
  const tasks = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      projectId: taskTable.projectId,
      userId: taskTable.userId,
      dueDate: taskTable.dueDate,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    // #202: tasks belonging to a soft-deleted project are gone for ordinary use
    // during that project's 30-day recovery window (#187, PR-16), so a bulk
    // operation skips them exactly as if their ids had not been sent -- and if
    // every requested id is under a deleted project, `tasks.length === 0` below
    // reports the same 404 a genuinely unknown id already gets.
    .where(
      and(
        inArray(taskTable.id, taskIds),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    );

  if (tasks.length === 0) {
    throw new HTTPException(404, {
      message: "No tasks found",
    });
  }

  const foundIds = tasks.map((t) => t.id);
  let updatedCount = 0;

  switch (operation) {
    case "updateStatus": {
      if (!value) {
        throw new HTTPException(400, { message: "Status value is required" });
      }
      const projectIds = [...new Set(tasks.map((t) => t.projectId))];

      for (const projectId of projectIds) {
        await assertValidTaskStatus(value, projectId);

        const column = await db.query.columnTable.findFirst({
          where: and(
            eq(columnTable.projectId, projectId),
            eq(columnTable.slug, value),
          ),
        });

        const projectTaskIds = tasks
          .filter((t) => t.projectId === projectId)
          .map((t) => t.id);

        const result = await db
          .update(taskTable)
          .set({ status: value, columnId: column?.id ?? null })
          .where(inArray(taskTable.id, projectTaskIds));

        updatedCount += result.rowCount ?? projectTaskIds.length;

        for (const taskId of projectTaskIds) {
          await publishEvent("task.status_changed", {
            taskId,
            projectId,
            userId,
            newStatus: value,
            type: "status_changed",
          });
        }

        await publishEvent("task-relation.refresh", {
          projectId,
          userId,
        });
      }
      break;
    }

    case "updatePriority": {
      if (!value) {
        throw new HTTPException(400, { message: "Priority value is required" });
      }
      assertValidPriority(value);

      const result = await db
        .update(taskTable)
        .set({ priority: value })
        .where(inArray(taskTable.id, foundIds));

      updatedCount = result.rowCount ?? foundIds.length;

      for (const task of tasks) {
        await publishEvent("task.priority_changed", {
          taskId: task.id,
          projectId: task.projectId,
          userId,
          newPriority: value,
          type: "priority_changed",
        });
      }
      break;
    }

    case "updateAssignee": {
      const assigneeId = value?.trim() || null;

      if (assigneeId) {
        await assertAssignableUser(assigneeId, workspaceId);
      }

      const newAssigneeName = assigneeId
        ? (
            await db
              .select({ name: userTable.name })
              .from(userTable)
              .where(eq(userTable.id, assigneeId))
              .limit(1)
          )[0]?.name
        : undefined;

      const result = await db
        .update(taskTable)
        .set({ userId: assigneeId })
        .where(inArray(taskTable.id, foundIds));

      updatedCount = result.rowCount ?? foundIds.length;

      for (const task of tasks) {
        const eventType = assigneeId
          ? "task.assignee_changed"
          : "task.unassigned";
        await publishEvent(eventType, {
          taskId: task.id,
          projectId: task.projectId,
          userId,
          oldAssignee: task.userId,
          newAssignee: newAssigneeName,
          newAssigneeId: assigneeId,
          title: task.title,
          type: assigneeId ? "assignee_changed" : "unassigned",
        });
      }
      break;
    }

    case "delete": {
      const result = await db
        .delete(taskTable)
        .where(inArray(taskTable.id, foundIds));

      updatedCount = result.rowCount ?? foundIds.length;

      for (const task of tasks) {
        await publishEvent("task.deleted", {
          taskId: task.id,
          projectId: task.projectId,
          userId,
          title: task.title,
        });
      }
      break;
    }

    case "addLabel": {
      if (!value) {
        throw new HTTPException(400, { message: "Label ID is required" });
      }
      // S5 (Opus review of PR #307, delta round): reaches the query below
      // unvalidated -- a NUL byte would otherwise 500 instead of a clean 400.
      rejectNulByte(value, "Label id");

      // S2 (Opus review of PR #307, delta round): scoped to `workspaceId` (or no
      // workspace at all -- a label with a null `workspaceId` is not tied to any
      // one workspace) in the query itself, so a label id belonging to ANOTHER
      // workspace is indistinguishable from a nonexistent one -- both now 404
      // here, instead of a nonexistent id 404ing while a foreign id resolved and
      // then 400'd "must belong to the same workspace", which is the #290/#285
      // existence-oracle class applied to label ids.
      const label = await db.query.labelTable.findFirst({
        where: and(
          eq(labelTable.id, value),
          or(
            eq(labelTable.workspaceId, workspaceId),
            isNull(labelTable.workspaceId),
          ),
        ),
      });

      if (!label) {
        throw new HTTPException(404, { message: "Label not found" });
      }

      for (const task of tasks) {
        const existingAssignment = await db.query.labelTable.findFirst({
          where: and(
            eq(labelTable.name, label.name),
            eq(labelTable.taskId, task.id),
          ),
        });

        if (!existingAssignment) {
          await db
            .insert(labelTable)
            .values({
              name: label.name,
              color: label.color,
              workspaceId: workspaceId,
              taskId: task.id,
            })
            .onConflictDoNothing({
              target: [labelTable.taskId, labelTable.name],
            });
          updatedCount++;

          await publishEvent("task.label_assigned", {
            projectId: task.projectId,
            taskId: task.id,
            userId,
            type: "label_assigned",
          });
        }
      }
      break;
    }

    case "removeLabel": {
      if (!value) {
        throw new HTTPException(400, { message: "Label ID is required" });
      }
      // S5 (Opus review of PR #307, delta round): reaches the query below
      // unvalidated -- a NUL byte would otherwise 500 instead of a clean 400.
      rejectNulByte(value, "Label id");

      // S2 (Opus review of PR #307, delta round): same scoping as `addLabel`
      // above -- a foreign label id used to silently no-op here (200,
      // `updatedCount: 0`, from the DELETE's own workspace-scoped WHERE), while a
      // nonexistent one 404'd. Scoping the initial lookup itself makes both 404.
      const label = await db.query.labelTable.findFirst({
        where: and(
          eq(labelTable.id, value),
          or(
            eq(labelTable.workspaceId, workspaceId),
            isNull(labelTable.workspaceId),
          ),
        ),
      });

      if (!label) {
        throw new HTTPException(404, { message: "Label not found" });
      }

      const deletedLabels = await db
        .delete(labelTable)
        .where(
          and(
            eq(labelTable.workspaceId, workspaceId),
            eq(labelTable.name, label.name),
            inArray(labelTable.taskId, foundIds),
          ),
        )
        .returning();

      updatedCount = deletedLabels.length;

      for (const deletedLabel of deletedLabels) {
        if (!deletedLabel.taskId) continue;

        const task = tasks.find((t) => t.id === deletedLabel.taskId);
        if (!task) continue;

        await publishEvent("task.label_unassigned", {
          label: deletedLabel,
          task,
          projectId: task.projectId,
          taskId: deletedLabel.taskId,
          userId,
          type: "label_unassigned",
        });
      }
      break;
    }

    case "updateDueDate": {
      let parsedDate: Date | null = null;
      if (value) {
        parsedDate = new Date(value);
        if (Number.isNaN(parsedDate.getTime())) {
          throw new HTTPException(400, {
            message: `Invalid date value "${value}"`,
          });
        }
      }

      const result = await db
        .update(taskTable)
        .set({ dueDate: parsedDate })
        .where(inArray(taskTable.id, foundIds));

      updatedCount = result.rowCount ?? foundIds.length;

      for (const task of tasks) {
        await publishEvent("task.due_date_changed", {
          taskId: task.id,
          projectId: task.projectId,
          userId,
          oldDueDate: task.dueDate,
          newDueDate: parsedDate,
          title: task.title,
          type: "due_date_changed",
        });
      }
      break;
    }

    default: {
      throw new HTTPException(400, {
        message: `Unknown operation "${operation}"`,
      });
    }
  }

  return { success: true, updatedCount };
}

export default bulkUpdateTasks;
