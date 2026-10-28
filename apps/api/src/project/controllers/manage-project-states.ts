import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  stateTable,
  stateTemplateTable,
  workflowTable,
  workflowTransitionTable,
  workItemTypeTable,
  workspaceTable,
} from "../../database/schema";
import {
  moveStateToPosition,
  templateHasOutboundTransition,
} from "../state-guard";

type Executor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

/** `from_state_template_id` of every transition in the ACTIVE version of every workflow a
 * work-item type of this workspace uses (WF-1/WF-2). */
async function activeTransitionFromTemplates(
  executor: Executor,
  workspaceId: string,
): Promise<Array<string | null>> {
  const rows = await executor
    .select({ from: workflowTransitionTable.fromStateTemplateId })
    .from(workflowTransitionTable)
    .innerJoin(
      workflowTable,
      eq(workflowTable.activeVersionId, workflowTransitionTable.versionId),
    )
    .where(
      and(
        eq(workflowTable.workspaceId, workspaceId),
        inArray(
          workflowTable.id,
          executor
            .select({ id: workItemTypeTable.workflowId })
            .from(workItemTypeTable)
            .where(
              and(
                eq(workItemTypeTable.workspaceId, workspaceId),
                isNotNull(workItemTypeTable.workflowId),
              ),
            ),
        ),
      ),
    );
  return rows.map((row) => row.from);
}

/** Workspace first, matching workspace-template writers; then serialize project edits. */
async function lockLiveProject(
  tx: Executor,
  projectId: string,
  workspaceId: string,
) {
  const [workspace] = await tx
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .for("share")
    .limit(1);
  if (!workspace)
    throw new HTTPException(404, { message: "Project not found" });
  const [project] = await tx
    .select({ id: projectTable.id, stateSetMode: projectTable.stateSetMode })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  return project;
}

/** The workspace's active state templates with whether this project already has an active
 * concrete state for each, and whether the workflows give it an outbound transition. */
export async function listProjectStateTemplates(
  projectId: string,
  workspaceId: string,
) {
  const [project] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!project) throw new HTTPException(404, { message: "Project not found" });

  const templates = await db
    .select({
      id: stateTemplateTable.id,
      name: stateTemplateTable.name,
      group: stateTemplateTable.group,
    })
    .from(stateTemplateTable)
    .where(
      and(
        eq(stateTemplateTable.workspaceId, workspaceId),
        isNull(stateTemplateTable.archivedAt),
      ),
    )
    .orderBy(asc(stateTemplateTable.name), asc(stateTemplateTable.id));
  const used = await db
    .select({ templateId: stateTable.stateTemplateId })
    .from(stateTable)
    .where(
      and(eq(stateTable.projectId, projectId), isNull(stateTable.archivedAt)),
    );
  const usedIds = new Set(used.map((row) => row.templateId));
  const fromTemplates = await activeTransitionFromTemplates(db, workspaceId);
  return templates.map((template) => ({
    ...template,
    group: template.group as
      | "backlog"
      | "unstarted"
      | "started"
      | "completed"
      | "cancelled",
    inUse: usedIds.has(template.id),
    hasOutboundTransition: templateHasOutboundTransition(
      template.id,
      fromTemplates,
    ),
  }));
}

/** Create a concrete state for a workspace template, appended last (PR-17, WF-2). */
export async function createProjectState(
  projectId: string,
  workspaceId: string,
  stateTemplateId: string,
) {
  return db.transaction(async (tx) => {
    await lockLiveProject(tx, projectId, workspaceId);

    const [template] = await tx
      .select({ id: stateTemplateTable.id })
      .from(stateTemplateTable)
      .where(
        and(
          eq(stateTemplateTable.id, stateTemplateId),
          eq(stateTemplateTable.workspaceId, workspaceId),
          isNull(stateTemplateTable.archivedAt),
        ),
      )
      .limit(1);
    if (!template) {
      throw new HTTPException(422, { message: "state_template_not_found" });
    }

    const active = await tx
      .select({
        templateId: stateTable.stateTemplateId,
        position: stateTable.position,
      })
      .from(stateTable)
      .where(
        and(eq(stateTable.projectId, projectId), isNull(stateTable.archivedAt)),
      );
    if (active.some((row) => row.templateId === stateTemplateId)) {
      throw new HTTPException(409, {
        message: "project_state_already_exists_for_template",
      });
    }

    const fromTemplates = await activeTransitionFromTemplates(tx, workspaceId);
    if (!templateHasOutboundTransition(stateTemplateId, fromTemplates)) {
      throw new HTTPException(422, {
        message:
          "PR-17: no workflow used by this workspace's work item types has a transition out of that state template",
      });
    }

    const nextPosition =
      active.reduce((max, row) => Math.max(max, row.position), -1) + 1;
    const [created] = await tx
      .insert(stateTable)
      .values({
        projectId,
        stateTemplateId,
        position: nextPosition,
        // A project's first state becomes its default (WI-4 needs exactly one).
        isDefault: active.length === 0,
      })
      .returning({ id: stateTable.id });
    await tx
      .update(projectTable)
      .set({
        stateSetMode: "override",
        projectSettingsVersion: sql`${projectTable.projectSettingsVersion} + 1`,
      })
      .where(eq(projectTable.id, projectId));
    return created;
  });
}

/** Re-order and/or re-nominate the default among a project's active states (PR-17). */
export async function updateProjectState(
  projectId: string,
  workspaceId: string,
  stateId: string,
  change: { position?: number; isDefault?: true },
) {
  return db.transaction(async (tx) => {
    await lockLiveProject(tx, projectId, workspaceId);

    const active = await tx
      .select({ id: stateTable.id, isDefault: stateTable.isDefault })
      .from(stateTable)
      .where(
        and(eq(stateTable.projectId, projectId), isNull(stateTable.archivedAt)),
      )
      .orderBy(asc(stateTable.position), asc(stateTable.id));
    const target = active.find((row) => row.id === stateId);
    if (!target) throw new HTTPException(404, { message: "State not found" });

    if (change.position !== undefined) {
      const order = moveStateToPosition(
        active.map((row) => row.id),
        stateId,
        change.position,
      );
      if (order) {
        for (const [index, id] of order.entries()) {
          await tx
            .update(stateTable)
            .set({ position: index })
            .where(
              and(eq(stateTable.id, id), eq(stateTable.projectId, projectId)),
            );
        }
      }
    }

    if (change.isDefault === true && !target.isDefault) {
      // The partial unique index `state_project_default_unique` allows one default: clear
      // the old one first, in the same transaction.
      await tx
        .update(stateTable)
        .set({ isDefault: false })
        .where(
          and(
            eq(stateTable.projectId, projectId),
            eq(stateTable.isDefault, true),
          ),
        );
      await tx
        .update(stateTable)
        .set({ isDefault: true })
        .where(
          and(eq(stateTable.id, stateId), eq(stateTable.projectId, projectId)),
        );
    }
    return { id: stateId };
  });
}
