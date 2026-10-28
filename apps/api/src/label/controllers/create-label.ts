import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { recordLegacyTaskCompatibilityEvent } from "../../events/legacy-task-compatibility";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { resolveCatalogueKey } from "../catalogue-key";
import {
  findProjectWorkspaceId,
  findTaskLabelByName,
  findTaskWithWorkspace,
  findWorkspaceLabelByName,
  insertTaskLabelOnConflictDoNothing,
  insertWorkspaceLabelOnConflictDoNothing,
  lockWorkspaceLabelNames,
} from "../repository";

async function createLabel(
  identity: ResolvedIdentity,
  name: string,
  color: string,
  taskId: string | undefined,
  workspaceId: string,
  userId: string,
  key?: string,
  apiKeyId?: string | null,
) {
  if (taskId) {
    // #290 S4 sweep: `taskId` is a body field, not covered by any
    // `workspaceAccess.*` lookup (`createLabelRoute` scopes from `workspaceId`, not
    // `taskId`) -- a NUL byte here reached `eq(taskTable.id, taskId)` unvalidated and
    // 500'd, the same class #281 fixed for path/query ids.
    rejectNulByte(taskId, "Task id");
    const task = await findTaskWithWorkspace(identity, taskId);

    if (!task) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    if (task.workspaceId !== workspaceId) {
      throw new HTTPException(404, {
        message: "Task not found",
      });
    }

    const { label, inserted, projectId } = await db.transaction(async (tx) => {
      // A workspace-label cascade and every task-level create/edit/delete for
      // this name serialize before taking task/project locks. The cascade can
      // then re-read and lock every copy created before it acquired this key.
      await lockWorkspaceLabelNames(tx, workspaceId, [name]);
      const lockedTask = await lockTaskAndAssertProjectLive(tx, taskId);
      const project = await findProjectWorkspaceId(tx, lockedTask.projectId);
      if (!project || project.workspaceId !== workspaceId) {
        throw new HTTPException(404, { message: "Task not found" });
      }
      const inserted = await insertTaskLabelOnConflictDoNothing(tx, identity, {
        name,
        color,
        taskId,
        workspaceId: project.workspaceId,
      });
      const label =
        inserted ?? (await findTaskLabelByName(tx, identity, taskId, name));
      if (inserted) {
        await recordLegacyTaskCompatibilityEvent(tx, {
          kind: "task.label_created",
          taskId: lockedTask.id,
          projectId: lockedTask.projectId,
          workspaceId: project.workspaceId,
          identity,
          apiKeyId,
          payload: { type: "label_created" },
        });
      }
      return { label, inserted, projectId: lockedTask.projectId };
    });

    if (!label) {
      throw new Error("Failed to create or resolve label");
    }

    if (inserted) {
      await publishEvent("task.label_created", {
        projectId,
        taskId: task.id,
        userId: userId,
        type: "label_created",
      });
    }
    return label;
  }

  const catalogueKey = resolveCatalogueKey(name, key);
  if (!catalogueKey)
    throw new HTTPException(422, {
      message: "A valid catalogue key is required",
    });
  let label: Awaited<ReturnType<typeof findWorkspaceLabelByName>>;
  try {
    label = await db.transaction(async (tx) => {
      await lockWorkspaceLabelNames(tx, workspaceId, [name]);
      const inserted = await insertWorkspaceLabelOnConflictDoNothing(
        tx,
        identity,
        { name, color, workspaceId, key: catalogueKey },
      );

      return (
        inserted ?? findWorkspaceLabelByName(tx, identity, workspaceId, name)
      );
    });
  } catch (error) {
    if (isUniqueViolation(error, "label_workspace_key_unique"))
      throw new HTTPException(409, { message: "catalogue_key_conflict" });
    throw error;
  }

  if (!label) {
    throw new Error("Failed to create or resolve label");
  }
  if (label.key !== catalogueKey)
    throw new HTTPException(409, { message: "catalogue_key_conflict" });

  return label;
}

export default createLabel;
