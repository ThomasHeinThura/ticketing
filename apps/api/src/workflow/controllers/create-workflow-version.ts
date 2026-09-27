import {
  asStateTemplateId,
  validateWorkflowVersion,
  type WorkflowState,
  type WorkflowTransition,
} from "@taskdesk/domain";
import { eq, isNull, max, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  roleTable,
  stateTemplateTable,
  workflowTable,
  workflowTransitionTable,
  workflowVersionTable,
} from "../../database/schema";
import type { z } from "../../openapi";
import type { createWorkflowVersionBody } from "../schema";

type TransitionInput = z.infer<
  typeof createWorkflowVersionBody
>["transitions"][number];

/**
 * Creates a new DRAFT version for `workflowId`, running `validateWorkflowVersion`
 * (`packages/domain/src/workflow/workflow.ts`) against this workspace's own state
 * templates before persisting anything — the same fail-closed structural check
 * `workflows.md`'s "Workflow editor" validation panel runs before a publish, applied
 * here at creation time too, so a malformed draft never reaches the database at all.
 */
async function createWorkflowVersion(
  workflowId: string,
  transitions: readonly TransitionInput[],
) {
  const [workflow] = await db
    .select({ workspaceId: workflowTable.workspaceId })
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1);

  if (!workflow) {
    throw new HTTPException(404, { message: "Workflow not found" });
  }

  const templates = await db
    .select({ id: stateTemplateTable.id, group: stateTemplateTable.group })
    .from(stateTemplateTable)
    .where(eq(stateTemplateTable.workspaceId, workflow.workspaceId));

  const states: WorkflowState[] = templates.map((t) => ({
    id: asStateTemplateId(t.id),
    // `state_template.group` is a `CHECK`-constrained closed vocabulary at the
    // database (`state_template_group_allowed`); this cast is safe for a row already
    // written through that constraint, and matches the same reasoning
    // `default-state-templates.ts`'s own seed data relies on elsewhere in this codebase.
    group: t.group as WorkflowState["group"],
  }));

  // Cross-tenant reference check (B2/N1): `validateWorkflowVersion` only checks a
  // transition's OWN `fromStateTemplateId`/`toStateTemplateId` against `states` above --
  // it never sees `roleId` or a `schedule_transition` effect's `toStateTemplateId`, so
  // without this, workspace A could save a transition naming workspace B's role or state
  // template. Mirrors the same ownership-set pattern `states` above already uses: build
  // the set of ids this workspace may legally reference, then reject any transition that
  // names one outside it, before anything is persisted.
  const stateIds = new Set(states.map((s) => s.id));

  const roleRows = await db
    .select({ id: roleTable.id })
    .from(roleTable)
    .where(
      or(
        eq(roleTable.workspaceId, workflow.workspaceId),
        isNull(roleTable.workspaceId),
      ),
    );
  const roleIds = new Set(roleRows.map((r) => r.id));

  for (const t of transitions) {
    if (t.roleId !== null && !roleIds.has(t.roleId)) {
      throw new HTTPException(400, {
        message: `Invalid workflow version: transition references a role not in this workspace: ${t.roleId}`,
      });
    }
    for (const effect of t.effects) {
      if (
        effect.kind === "schedule_transition" &&
        !stateIds.has(asStateTemplateId(effect.toStateTemplateId))
      ) {
        throw new HTTPException(400, {
          message: `Invalid workflow version: schedule_transition effect names a to-state that does not exist: ${effect.toStateTemplateId}`,
        });
      }
    }
  }

  const domainTransitions: WorkflowTransition[] = transitions.map(
    (t, index) => ({
      id: `draft-${index}`,
      fromStateTemplateId:
        t.fromStateTemplateId === null
          ? null
          : asStateTemplateId(t.fromStateTemplateId),
      toStateTemplateId: asStateTemplateId(t.toStateTemplateId),
      roleId: t.roleId,
      notePolicy: t.notePolicy,
      noteVisibility: t.noteVisibility,
      requiresApproval: t.requiresApproval,
      approvalPolicy: t.approvalPolicy,
      requiresCab: t.requiresCab,
      isReopen: t.isReopen,
      guards: t.guards,
      // `schedule_transition.toStateTemplateId` is a branded `StateTemplateId` in the
      // domain package (same brand as the transition's own `toStateTemplateId` above) --
      // the request body only carries a plain string, so it is promoted here, at the one
      // impure edge `asStateTemplateId`'s own doc comment calls for.
      effects: t.effects.map((effect) =>
        effect.kind === "schedule_transition"
          ? {
              ...effect,
              toStateTemplateId: asStateTemplateId(effect.toStateTemplateId),
            }
          : effect,
      ),
    }),
  );

  const result = validateWorkflowVersion(states, domainTransitions);
  if (!result.valid) {
    throw new HTTPException(400, {
      message: `Invalid workflow version: ${result.errors.join("; ")}`,
    });
  }

  return db.transaction(async (tx) => {
    const [maxRow] = await tx
      .select({ nextNumber: max(workflowVersionTable.number) })
      .from(workflowVersionTable)
      .where(eq(workflowVersionTable.workflowId, workflowId));

    const [version] = await tx
      .insert(workflowVersionTable)
      .values({ workflowId, number: (maxRow?.nextNumber ?? 0) + 1 })
      .returning();

    if (!version) {
      throw new Error("Failed to create workflow version");
    }

    const insertedTransitions = transitions.length
      ? await tx
          .insert(workflowTransitionTable)
          .values(
            transitions.map((t) => ({
              versionId: version.id,
              fromStateTemplateId: t.fromStateTemplateId,
              toStateTemplateId: t.toStateTemplateId,
              roleId: t.roleId,
              notePolicy: t.notePolicy,
              noteVisibility: t.noteVisibility,
              requiresApproval: t.requiresApproval,
              approvalPolicy: t.approvalPolicy,
              requiresCab: t.requiresCab,
              isReopen: t.isReopen,
              guards: t.guards,
              effects: t.effects,
            })),
          )
          .returning()
      : [];

    return { ...version, transitions: insertedTransitions };
  });
}

export default createWorkflowVersion;
