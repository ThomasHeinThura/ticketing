import {
  asStateTemplateId,
  validateWorkflowVersion,
  type WorkflowState,
  type WorkflowTransition,
} from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { AppendAuditLogInput } from "../../audit/audit-writer";
import db from "../../database";
import { workflowTable } from "../../database/schema";
import { appendAuditSavepoint } from "../../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../../instance/observability/audit-failure-notifier";
import type { z } from "../../openapi";
import { lockReferencedRolesForShare } from "../../workspace/role.repository";
import {
  findWorkflowWorkspaceId,
  getMaxVersionNumber,
  insertWorkflowTransitions,
  insertWorkflowVersion,
  listReferenceableRoleIds,
  listStateTemplates,
} from "../repository";
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
  identity: ResolvedIdentity,
  workflowId: string,
  transitions: readonly TransitionInput[],
  actor: Pick<
    AppendAuditLogInput,
    | "actorId"
    | "actorType"
    | "apiKeyId"
    | "impersonatorId"
    | "actorIp"
    | "userAgent"
    | "traceId"
  >,
) {
  if (
    transitions.some((transition) =>
      transition.effects.some((effect) => effect.kind === "set_field"),
    )
  ) {
    throw new HTTPException(400, {
      message:
        "Invalid workflow version: set_field is held for this release and cannot be authored",
    });
  }

  const workflow = await findWorkflowWorkspaceId(identity, workflowId);

  if (!workflow) {
    throw new HTTPException(404, { message: "Workflow not found" });
  }

  const templates = await listStateTemplates(identity, workflow.workspaceId);

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

  const roleRows = await listReferenceableRoleIds(
    identity,
    workflow.workspaceId,
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

  const validation = validateWorkflowVersion(states, domainTransitions);
  if (!validation.valid) {
    throw new HTTPException(400, {
      message: `Invalid workflow version: ${validation.errors.join("; ")}`,
    });
  }

  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: workflowTable.id })
      .from(workflowTable)
      .where(
        and(
          eq(workflowTable.id, workflowId),
          eq(workflowTable.workspaceId, workflow.workspaceId),
        ),
      )
      .for("share")
      .limit(1);
    if (!current)
      throw new HTTPException(404, { message: "Workflow not found" });
    // The pre-transaction role check holds no lock. Share-lock every referenced role (id order;
    // role delete takes only the role row FOR UPDATE, so there is no cycle) and recheck: a role
    // deleted meanwhile is a clean 409, never an FK violation, and a role locked here makes a
    // concurrent delete wait and then refuse because a transition references it.
    const referencedRoleIds = [
      ...new Set(
        transitions.flatMap((t) => (t.roleId === null ? [] : [t.roleId])),
      ),
    ].sort();
    if (referencedRoleIds.length > 0) {
      const lockedCount = await lockReferencedRolesForShare(
        tx,
        referencedRoleIds,
      );
      if (lockedCount !== referencedRoleIds.length)
        throw new HTTPException(409, { message: "workflow_role_deleted" });
    }
    const maxRow = await getMaxVersionNumber(tx, workflowId);

    const version = await insertWorkflowVersion(tx, {
      workflowId,
      number: (maxRow?.nextNumber ?? 0) + 1,
    });

    if (!version) {
      throw new Error("Failed to create workflow version");
    }

    const insertedTransitions = transitions.length
      ? await insertWorkflowTransitions(
          tx,
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
      : [];

    const auditFailed = await appendAuditSavepoint(tx, {
      ...actor,
      workspaceId: workflow.workspaceId,
      action: "workflow.version_created",
      entityType: "workflow",
      entityId: workflowId,
      after: { versionId: version.id, changedFields: ["definition"] },
    });
    return {
      version: { ...version, transitions: insertedTransitions },
      auditFailed,
    };
  });
  if (result.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return result.version;
}

export default createWorkflowVersion;
