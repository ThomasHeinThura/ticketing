import { createHash } from "node:crypto";
import {
  asStateTemplateId,
  validateWorkflowVersion,
  type WorkflowState,
  type WorkflowTransition,
} from "@taskdesk/domain";
import {
  type Executor,
  executorOrDefault,
  type Transaction,
} from "../database/executor";
import { DEFAULT_STATE_TEMPLATES } from "./default-state-templates";
import { DEFAULT_WORK_ITEM_TYPES } from "./default-work-item-types";
import {
  attachDefaultWorkflow,
  insertDefaultWorkflowDraft,
  insertDefaultWorkflowEdges,
  listWorkspacesWithUnboundBuiltinTypes,
  lockWorkspaceDefaults,
  publishDefaultWorkflow,
  readDefaultWorkflowContext,
  readSeedWorkflowVersion,
} from "./seed-default-workflow.repository";

export function defaultWorkflowId(workspaceId: string): string {
  return `default-workflow-${createHash("sha256").update(workspaceId).digest("hex")}`;
}
export class DefaultWorkflowSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DefaultWorkflowSeedError";
  }
}
function assertValid(
  states: WorkflowState[],
  transitions: WorkflowTransition[],
) {
  const result = validateWorkflowVersion(states, transitions);
  if (!result.valid)
    throw new DefaultWorkflowSeedError(
      `Default workflow is invalid: ${result.errors.join("; ")}`,
    );
}
/** Called under the workspace lock before type/template writes; never edits a published graph. */
export async function seedDefaultWorkflowInTransaction(
  workspaceId: string,
  tx: Transaction,
) {
  const workflowId = defaultWorkflowId(workspaceId);
  const context = await readDefaultWorkflowContext(tx, workspaceId, workflowId);
  if (
    context.workflows.some(
      (row) => row.id !== workflowId || row.workspaceId !== workspaceId,
    )
  )
    throw new DefaultWorkflowSeedError(
      "Default workflow key collides with customer configuration; no types were attached",
    );
  const existing = context.workflows.find((row) => row.id === workflowId);
  const states: WorkflowState[] = context.templates.map((row) => ({
    id: asStateTemplateId(row.id),
    group: row.group as WorkflowState["group"],
  }));
  if (existing) {
    if (!existing.activeVersionId)
      throw new DefaultWorkflowSeedError(
        "Default workflow has no published active version; no types were attached",
      );
    const { version, transitions } = await readSeedWorkflowVersion(
      tx,
      workflowId,
      existing.activeVersionId,
    );
    if (!version?.publishedAt)
      throw new DefaultWorkflowSeedError(
        "Default workflow active version is not published; no types were attached",
      );
    assertValid(
      states,
      transitions.map((row) => ({
        ...row,
        fromStateTemplateId:
          row.fromStateTemplateId === null
            ? null
            : asStateTemplateId(row.fromStateTemplateId),
        toStateTemplateId: asStateTemplateId(row.toStateTemplateId),
        notePolicy: row.notePolicy as WorkflowTransition["notePolicy"],
        noteVisibility:
          row.noteVisibility as WorkflowTransition["noteVisibility"],
        approvalPolicy:
          row.approvalPolicy as WorkflowTransition["approvalPolicy"],
        guards: row.guards as WorkflowTransition["guards"],
        effects: row.effects as WorkflowTransition["effects"],
      })),
    );
  } else {
    const defaults = DEFAULT_STATE_TEMPLATES.map((definition) => {
      const row = context.templates.find(
        (candidate) => candidate.key === definition.key,
      );
      if (!row || row.archivedAt || row.group !== definition.group)
        throw new DefaultWorkflowSeedError(
          "Default workflow requires the five active default template groups; customer templates were preserved",
        );
      return row;
    });
    const versionId = `${workflowId}-v1`;
    const transitions: WorkflowTransition[] = defaults.flatMap((from) =>
      defaults
        .filter((to) => to.id !== from.id)
        .map((to) => ({
          id: `${versionId}-${from.key}-${to.key}`,
          fromStateTemplateId: asStateTemplateId(from.id),
          toStateTemplateId: asStateTemplateId(to.id),
          roleId: null,
          notePolicy: "none",
          noteVisibility: "internal",
          requiresApproval: false,
          approvalPolicy: null,
          requiresCab: false,
          isReopen: from.group === "completed" && to.group === "unstarted",
          guards: [],
          effects: [],
        })),
    );
    assertValid(states, transitions);
    await insertDefaultWorkflowDraft(tx, workspaceId, workflowId, versionId);
    await insertDefaultWorkflowEdges(
      tx,
      transitions.map((row) => ({ ...row, versionId })),
    );
    // Validate the rows actually persisted, not merely the proposed input.
    const persisted = await readSeedWorkflowVersion(tx, workflowId, versionId);
    if (!persisted.version || persisted.transitions.length !== 20)
      throw new DefaultWorkflowSeedError(
        "Default workflow persistence was incomplete",
      );
    assertValid(
      states,
      persisted.transitions.map((row) => ({
        ...row,
        fromStateTemplateId: asStateTemplateId(row.fromStateTemplateId ?? ""),
        toStateTemplateId: asStateTemplateId(row.toStateTemplateId),
        notePolicy: row.notePolicy as WorkflowTransition["notePolicy"],
        noteVisibility:
          row.noteVisibility as WorkflowTransition["noteVisibility"],
        approvalPolicy:
          row.approvalPolicy as WorkflowTransition["approvalPolicy"],
        guards: row.guards as WorkflowTransition["guards"],
        effects: row.effects as WorkflowTransition["effects"],
      })),
    );
    await publishDefaultWorkflow(tx, workflowId, versionId);
  }
  const attachedTypes = await attachDefaultWorkflow(
    tx,
    workspaceId,
    workflowId,
    DEFAULT_WORK_ITEM_TYPES.map((row) => row.key),
  );
  return { workflowId, attachedTypes };
}
/** Explicit repair of unconfigured builtin types; no work item, state or custom workflow writes. */
export async function seedDefaultWorkflow(
  workspaceId: string,
  executor?: Executor,
) {
  return executorOrDefault(executor).transaction(async (tx) => {
    await lockWorkspaceDefaults(tx, workspaceId);
    return seedDefaultWorkflowInTransaction(workspaceId, tx);
  });
}

/**
 * Boot repair for workspaces created before default workflows existed (or seeded by the legacy
 * backfill): attaches the validated default workflow to their unconfigured builtin types so
 * work-item creation (WI-4: the default state must be leaveable) works. One workspace's
 * failure (for example customer templates that block the default graph) never stops the rest.
 */
export async function repairDefaultWorkflows(): Promise<{
  repaired: number;
  failed: number;
}> {
  let repaired = 0;
  let failed = 0;
  const workspaceIds = await listWorkspacesWithUnboundBuiltinTypes(
    DEFAULT_WORK_ITEM_TYPES.map((row) => row.key),
  );
  for (const workspaceId of workspaceIds) {
    try {
      const result = await seedDefaultWorkflow(workspaceId);
      if (result.attachedTypes > 0) repaired += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        `⚠️ Default workflow repair skipped workspace ${workspaceId}: ${
          error instanceof Error ? error.name : "unknown error"
        }`,
      );
    }
  }
  return { repaired, failed };
}
