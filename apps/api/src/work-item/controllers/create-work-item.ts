import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Transaction } from "../../database/executor";
import {
  slaPolicyTable,
  slaPolicyVersionTable,
  workItemTable,
  workspaceTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { resolveProjectDefaultAssignee } from "../../project/default-assignee";
import { resolveProjectSlaPolicyId } from "../../project/effective-settings";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { type ActivityActorType, recordWorkItemActivity } from "../activity";
import {
  publishInitialWorkItemFields,
  recordInitialWorkItemFields,
} from "../create-initial-fields";
import {
  type CreateAuthorization,
  type InitialWorkItemFields,
  prepareWorkItemCreation,
  withCreationTransaction,
} from "../create-preparation";
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";
import { claimWorkItemNumber } from "./claim-work-item-number";

/**
 * `work_item.created`'s `source` (`events.md` ~51: `portal|agent|api|automation|import`),
 * derived from `resolveActor`'s `actorType`. This route only ever sees a cookie-session
 * `person` or an `api_key` (`resolveActor`'s own doc comment) -- `automation`/`system`
 * throw rather than silently falling back to `"agent"`, so a future caller that reuses
 * this function for an automation/import/portal-intake path is forced to update this
 * mapping instead of getting a wrong `source` with no signal (same discipline as #399's
 * `repo.mjs` fix: fail loudly on an unexpected case, don't silently default).
 */
function eventSourceFor(actorType: ActivityActorType): "agent" | "api" {
  switch (actorType) {
    case "person":
      return "agent";
    case "api_key":
      return "api";
    case "automation":
    case "system":
      throw new Error(
        'createWorkItem: no work_item.created "source" mapping for actorType ' +
          `"${actorType}" -- this route's resolveActor never produces it today; if a ` +
          "new caller changes that, add the correct events.md source value here.",
      );
  }
}

export type CreateWorkItemInput = InitialWorkItemFields & {
  authorization?: CreateAuthorization;
  projectId: string;
  workspaceId: string;
  typeId: string;
  title: string;
  description?: unknown;
  priority?: "low" | "medium" | "high" | "urgent";
  /** The person making the request -- `c.get("userId")` at the route (WI-6, CA-9). */
  actorId: string;
  actorType: ActivityActorType;
  /** Import event provenance; the actor remains the real authenticated caller. */
  eventSource?: "import";
  /** Runs inside the create transaction right after the row and its initial fields (`WI-5` templates). */
  afterInsert?: (
    tx: Parameters<Parameters<typeof withCreationTransaction>[0]>[0],
    inserted: typeof workItemTable.$inferSelect,
  ) => Promise<void>;
};

/**
 * `WI-1`..`WI-4` (`docs/03-features/work-items.md`) -- the first write to `work_item`.
 * Every validation below is deliberately at the APPLICATION layer, ahead of the INSERT,
 * so a caller gets a clean 4xx rather than a raw Postgres constraint-violation error --
 * the DB-level composite FKs (#192) are the backstop, not the primary control a caller
 * ever sees.
 */
export type CreatedWorkItemTransactionResult = {
  created: typeof workItemTable.$inferSelect;
  realtimeEvent: Awaited<ReturnType<typeof recordWorkItemEvent>> | undefined;
  initialEvents: Awaited<ReturnType<typeof recordInitialWorkItemFields>>;
  source: "agent" | "api" | "import";
  actorId: string;
  actorType: ActivityActorType;
};

/** Create one work item and all its canonical rows inside a caller-owned transaction. */
export async function createWorkItemInTransaction(
  tx: Transaction,
  input: CreateWorkItemInput,
): Promise<CreatedWorkItemTransactionResult> {
  const { title, description, priority, actorId, actorType } = input;

  // Resolved BEFORE any database write (Opus review, #412 F1): if `actorType` is ever
  // something `eventSourceFor` doesn't map, this throws here -- a clean failure before
  // the transaction below starts -- rather than after the work item and its `created`
  // activity row have already committed, which would 500 a client that just succeeded
  // and risk a duplicate on retry.
  if (input.authorization && input.authorization.userId !== actorId)
    throw new HTTPException(403, {
      message: "Actor does not match authorization context",
    });

  const source = input.eventSource ?? eventSourceFor(actorType);
  const { project, type, defaultState } = await prepareWorkItemCreation(
    tx,
    input,
  );
  const defaultAssigneeId =
    input.assigneeId === undefined
      ? await resolveProjectDefaultAssignee(tx, { projectId: project.id })
      : null;
  const effectiveFields =
    defaultAssigneeId === null
      ? input
      : { ...input, assigneeId: defaultAssigneeId };
  const slaStartedAt = new Date();
  const [workspace] = await tx
    .select({ slaPolicyId: workspaceTable.defaultSlaPolicyId })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, project.workspaceId))
    .limit(1);
  if (!workspace) {
    throw new Error("Work item's workspace disappeared during creation");
  }
  const policyId =
    type.slaPolicyId ??
    resolveProjectSlaPolicyId({
      mode: project.slaPolicyMode as "inherit" | "override",
      overrideId: project.slaPolicyId,
      workspaceDefaultId: workspace.slaPolicyId,
    });
  if (policyId) {
    const [ownedPolicy] = await tx
      .select({ id: slaPolicyTable.id })
      .from(slaPolicyTable)
      .where(
        and(
          eq(slaPolicyTable.id, policyId),
          eq(slaPolicyTable.workspaceId, project.workspaceId),
        ),
      )
      .limit(1);
    if (!ownedPolicy) {
      throw new Error("Work item SLA binding is outside its workspace");
    }
  }
  const [policyVersion] = policyId
    ? await tx
        .select({ id: slaPolicyVersionTable.id })
        .from(slaPolicyVersionTable)
        .where(
          and(
            eq(slaPolicyVersionTable.workspaceId, project.workspaceId),
            eq(slaPolicyVersionTable.policyId, policyId),
            isNotNull(slaPolicyVersionTable.effectiveFrom),
            lte(slaPolicyVersionTable.effectiveFrom, slaStartedAt),
          ),
        )
        .orderBy(
          desc(slaPolicyVersionTable.effectiveFrom),
          desc(slaPolicyVersionTable.number),
        )
        .limit(1)
    : [];
  const number = await claimWorkItemNumber(project.id, tx);
  const key = `${project.slug}-${number}`;

  const [inserted] = await tx
    .insert(workItemTable)
    .values({
      projectId: project.id,
      workspaceId: project.workspaceId,
      typeId: type.id,
      number,
      key,
      title,
      description: description ?? null,
      stateId: defaultState.id,
      priority: priority ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      assigneeId: effectiveFields.assigneeId ?? null,
      createdAt: slaStartedAt,
      updatedAt: slaStartedAt,
      slaStartedAt,
      slaPolicyVersionId: policyVersion?.id ?? null,
    })
    .returning();

  if (!inserted) {
    throw new HTTPException(500, { message: "Failed to create work item" });
  }

  await recordWorkItemActivity(tx, [
    {
      workspaceId: inserted.workspaceId,
      workItemId: inserted.id,
      actorId,
      actorType,
      verb: "created",
      payload: { key: inserted.key, title: inserted.title },
    },
  ]);

  const realtimeEvent = await recordWorkItemEvent(tx, {
    kind: "work_item.created",
    workItemId: inserted.id,
    key: inserted.key,
    workspaceId: inserted.workspaceId,
    projectId: inserted.projectId,
    actorId,
    actorType,
    customerVisible: true,
    payload: {
      key: inserted.key,
      url: `/agent/work-items/${encodeURIComponent(inserted.key)}`,
      typeId: inserted.typeId,
      stateId: inserted.stateId,
      requesterId: inserted.requesterId,
      source,
    },
  });

  const initialEvents = await recordInitialWorkItemFields(
    tx,
    inserted,
    effectiveFields,
    actorId,
    actorType,
  );
  await input.afterInsert?.(tx, inserted);
  return {
    created: inserted,
    realtimeEvent,
    initialEvents,
    source,
    actorId,
    actorType,
  };
}

/** Publish side effects only after the transaction that created the item commits. */
export async function publishCreatedWorkItem(
  result: CreatedWorkItemTransactionResult,
) {
  const { created, realtimeEvent, initialEvents, source, actorId, actorType } =
    result;
  await publishEvent("work_item.created", {
    workItemId: created.id,
    key: created.key,
    workspaceId: created.workspaceId,
    projectId: created.projectId,
    typeId: created.typeId,
    stateId: created.stateId,
    requesterId: created.requesterId,
    source,
    visibility: "public",
    actorId,
    actorType,
  });
  if (realtimeEvent) {
    await publishWorkItemHint(realtimeEvent, {
      kind: "work_item.created",
      key: created.key,
      projectId: created.projectId,
      customerVisible: true,
    });
  }
  await publishInitialWorkItemFields(created, initialEvents);
}

export async function createWorkItem(input: CreateWorkItemInput) {
  if (input.eventSource !== undefined)
    throw new Error("The HTTP create route cannot override event provenance");
  let result: CreatedWorkItemTransactionResult;
  try {
    result = await withCreationTransaction((tx) =>
      createWorkItemInTransaction(tx, input),
    );
  } catch (error) {
    // Keep the existing public error for the only expected poisoned-key failure.
    if (isUniqueViolation(error, "work_item_key_claim_pkey")) {
      throw new HTTPException(409, {
        message:
          "This work item's key is already claimed by another work item; the project's key range may be poisoned by a retired slug -- contact an administrator",
      });
    }
    throw error;
  }
  await publishCreatedWorkItem(result);
  return result.created;
}

export default createWorkItem;
