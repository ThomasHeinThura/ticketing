import { randomUUID } from "node:crypto";
import {
  asStateTemplateId,
  validateWorkflowVersion,
  type WorkflowState,
  type WorkflowTransition,
} from "@taskdesk/domain";
import { and, eq, isNull, or } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";

/** Explicit opt-in fixture for tests that create a custom type and default state.
 * Never changes an existing configured workflow or the project's default state.
 */
export async function ensureCreationWorkflow(input: {
  workspaceId: string;
  projectId: string;
  typeId: string;
}) {
  return db.transaction(async (tx) => {
    const [type] = await tx
      .select()
      .from(schema.workItemTypeTable)
      .where(
        and(
          eq(schema.workItemTypeTable.id, input.typeId),
          eq(schema.workItemTypeTable.workspaceId, input.workspaceId),
        ),
      )
      .for("update");
    if (!type)
      throw new Error("Creation fixture type is outside its workspace");
    if (type.workflowId !== null) {
      await ensureLeaveableTargetState(tx, input, type.workflowId);
      return type.workflowId;
    }
    const [initial] = await tx
      .select({
        id: schema.stateTemplateTable.id,
        group: schema.stateTemplateTable.group,
      })
      .from(schema.stateTable)
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTemplateTable.id, schema.stateTable.stateTemplateId),
      )
      .where(
        and(
          eq(schema.stateTable.projectId, input.projectId),
          eq(schema.stateTable.isDefault, true),
          eq(schema.stateTemplateTable.workspaceId, input.workspaceId),
        ),
      );
    if (!initial)
      throw new Error(
        "Creation fixture needs its explicit default state first",
      );
    const id = `creation-fixture-${randomUUID()}`;
    const [target] = await tx
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: input.workspaceId,
        key: id,
        name: "Fixture completion target",
        group: initial.group === "completed" ? "unstarted" : "completed",
      })
      .returning();
    if (!target) throw new Error("Creation fixture target was not inserted");
    await tx.insert(schema.stateTable).values({
      projectId: input.projectId,
      stateTemplateId: target.id,
      isDefault: false,
    });
    const transitions: WorkflowTransition[] = [
      {
        id: `${id}-edge`,
        fromStateTemplateId: asStateTemplateId(initial.id),
        toStateTemplateId: asStateTemplateId(target.id),
        roleId: null,
        notePolicy: "none",
        noteVisibility: "internal",
        requiresApproval: false,
        approvalPolicy: null,
        requiresCab: false,
        isReopen: initial.group === "completed",
        guards: [],
        effects: [],
      },
    ];
    const validated = validateWorkflowVersion(
      [
        {
          id: asStateTemplateId(initial.id),
          group: initial.group as WorkflowState["group"],
        },
        {
          id: asStateTemplateId(target.id),
          group: target.group as WorkflowState["group"],
        },
      ],
      transitions,
    );
    if (!validated.valid)
      throw new Error(
        `Invalid creation fixture graph: ${validated.errors.join("; ")}`,
      );
    await tx.insert(schema.workflowTable).values({
      id,
      workspaceId: input.workspaceId,
      key: id,
      name: "Explicit creation fixture",
    });
    await tx
      .insert(schema.workflowVersionTable)
      .values({ id: `${id}-v1`, workflowId: id, number: 1 });
    await tx
      .insert(schema.workflowTransitionTable)
      .values(transitions.map((row) => ({ ...row, versionId: `${id}-v1` })));
    await tx
      .update(schema.workflowVersionTable)
      .set({ publishedAt: new Date() })
      .where(eq(schema.workflowVersionTable.id, `${id}-v1`));
    await tx
      .update(schema.workflowTable)
      .set({ activeVersionId: `${id}-v1` })
      .where(eq(schema.workflowTable.id, id));
    await tx
      .update(schema.workItemTypeTable)
      .set({ workflowId: id })
      .where(eq(schema.workItemTypeTable.id, type.id));
    return id;
  });
}

type CreationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A type shared by several projects keeps ONE workflow. For a project whose default state
 * template that workflow can already leave, make sure the project also holds a concrete state
 * for the edge's target (WI-4 needs the target to exist in the project). Only adds a missing
 * state row; never edits the workflow, the type or the project's default state.
 */
async function ensureLeaveableTargetState(
  tx: CreationTransaction,
  input: { workspaceId: string; projectId: string },
  workflowId: string,
) {
  const [workflow] = await tx
    .select()
    .from(schema.workflowTable)
    .where(eq(schema.workflowTable.id, workflowId));
  if (!workflow?.activeVersionId) return;
  const states = await tx
    .select()
    .from(schema.stateTable)
    .where(eq(schema.stateTable.projectId, input.projectId));
  const initial = states.find((state) => state.isDefault);
  if (!initial) return;
  const edges = await tx
    .select()
    .from(schema.workflowTransitionTable)
    .where(
      and(
        eq(schema.workflowTransitionTable.versionId, workflow.activeVersionId),
        or(
          isNull(schema.workflowTransitionTable.fromStateTemplateId),
          eq(
            schema.workflowTransitionTable.fromStateTemplateId,
            initial.stateTemplateId,
          ),
        ),
      ),
    );
  const edge = edges.find(
    (candidate) => candidate.toStateTemplateId !== initial.stateTemplateId,
  );
  if (!edge) return;
  if (states.some((state) => state.stateTemplateId === edge.toStateTemplateId))
    return;
  await tx.insert(schema.stateTable).values({
    projectId: input.projectId,
    stateTemplateId: edge.toStateTemplateId,
    isDefault: false,
  });
}
