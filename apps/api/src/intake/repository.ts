import { createId } from "@paralleldrive/cuid2";
import type { FormSchema, FormValue } from "@taskdesk/domain";
import {
  formatSubmissionReference,
  parseSubmissionReference,
  renderUnmappedIntoDescription,
  transitionSubmission,
  translateMapsTo,
  validateFormSchema,
  validateSubmissionData,
  visibleFields,
} from "@taskdesk/domain";
import { resolveFeatureFlag } from "@taskdesk/permissions";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import {
  type DbTransaction,
  enqueueOutboxEvent,
  eventScope,
} from "../events/outbox";
import { recordWorkItemActivity } from "../work-item/activity";
import { claimWorkItemNumber } from "../work-item/controllers/claim-work-item-number";
import { recordWorkItemEvent } from "../work-item/native-event";
import {
  findEffectiveSlaPolicyVersionQuery,
  findWorkspaceDefaultSlaPolicyQuery,
  findWorkspaceOwnedSlaPolicyQuery,
} from "../work-item/repository";

type RequestTypeInput = {
  workspaceId: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  group: string;
  workItemTypeId: string;
  defaultProjectId?: string | null;
  formSchema: FormSchema;
  slaPolicyId?: string | null;
  defaultAssigneeId?: string | null;
  autoAccept: boolean;
  customerVisible: boolean;
  forcePrivate: boolean;
  position: number;
};

export async function requestTypeWorkspace(id: string) {
  const [row] = await db
    .select({
      id: schema.requestTypeTable.id,
      workspaceId: schema.requestTypeTable.workspaceId,
    })
    .from(schema.requestTypeTable)
    .where(eq(schema.requestTypeTable.id, id))
    .limit(1);
  return row;
}

export async function listRequestTypes(workspaceId: string) {
  return db
    .select()
    .from(schema.requestTypeTable)
    .where(eq(schema.requestTypeTable.workspaceId, workspaceId))
    .orderBy(
      asc(schema.requestTypeTable.position),
      asc(schema.requestTypeTable.id),
    );
}

export async function getRequestType(id: string, workspaceId?: string) {
  const [row] = await db
    .select()
    .from(schema.requestTypeTable)
    .where(
      and(
        eq(schema.requestTypeTable.id, id),
        ...(workspaceId
          ? [eq(schema.requestTypeTable.workspaceId, workspaceId)]
          : []),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Request type not found" });
  const versions = await db
    .select()
    .from(schema.requestTypeVersionTable)
    .where(eq(schema.requestTypeVersionTable.requestTypeId, id))
    .orderBy(desc(schema.requestTypeVersionTable.number));
  return { ...row, versions };
}

export async function createRequestType(
  input: RequestTypeInput,
  actorId: string,
) {
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.requestTypeTable)
      .values({
        ...input,
        key: createId(),
        formSchema: input.formSchema,
      })
      .returning();
    if (!created)
      throw new HTTPException(500, {
        message: "Could not create request type",
      });
    await appendAuditLog(tx, {
      actorId,
      actorType: "person",
      workspaceId: input.workspaceId,
      action: "request_type.created",
      entityType: "request_type",
      entityId: created.id,
      after: { requestTypeId: created.id, workspaceId: created.workspaceId },
    });
    return created;
  });
  return row;
}

export async function updateRequestType(
  id: string,
  input: Partial<RequestTypeInput>,
  version: number,
  actorId: string,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, id))
      .for("update")
      .limit(1);
    if (!current)
      throw new HTTPException(404, { message: "Request type not found" });
    if (current.version !== version)
      throw new HTTPException(409, {
        message: "Request type changed; reload before saving",
      });
    if (current.published && input.customerVisible === true) {
      const [latest] = await tx
        .select()
        .from(schema.requestTypeVersionTable)
        .where(eq(schema.requestTypeVersionTable.requestTypeId, id))
        .orderBy(desc(schema.requestTypeVersionTable.number))
        .limit(1)
        .for("share");
      if (latest)
        await requireAutoAcceptAudienceBinding(tx, {
          requestTypeId: id,
          autoAccept: latest.autoAccept,
          workspaceId: current.workspaceId,
          projectId: latest.defaultProjectId,
        });
    }
    const [row] = await tx
      .update(schema.requestTypeTable)
      .set({ ...input, version: current.version + 1, updatedAt: new Date() })
      .where(
        and(
          eq(schema.requestTypeTable.id, id),
          eq(schema.requestTypeTable.version, version),
        ),
      )
      .returning();
    if (!row)
      throw new HTTPException(409, {
        message: "Request type changed; reload before saving",
      });
    await appendAuditLog(tx, {
      actorId,
      actorType: "person",
      workspaceId: row.workspaceId,
      action: "request_type.updated",
      entityType: "request_type",
      entityId: row.id,
      before: { version: current.version },
      after: { version: row.version, changedFields: Object.keys(input).sort() },
    });
    return row;
  });
}

function hasValidTitleMapping(formSchema: FormSchema) {
  const titleFields = formSchema.fields.filter(
    (field) => field.mapsTo?.field === "title",
  );
  return (
    titleFields.length === 1 &&
    titleFields[0]?.required === true &&
    (titleFields[0].type === "text" || titleFields[0].type === "textarea") &&
    (titleFields[0].showIf === undefined || titleFields[0].showIf === null)
  );
}

async function requireAutoAcceptProject(
  tx: DbTransaction,
  input: {
    autoAccept: boolean;
    workspaceId: string;
    projectId: string | null;
    organisationId?: string;
    audienceOrganisationIds?: readonly string[];
  },
) {
  if (!input.autoAccept) return;
  if (!input.projectId)
    throw new HTTPException(422, {
      message: "Auto-accept requires a default customer-serving project",
    });
  const [project] = await tx
    .select({
      id: schema.projectTable.id,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, input.projectId),
        eq(schema.projectTable.workspaceId, input.workspaceId),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    // Conversion later increments this same project row's work-item counter.
    .for("no key update")
    .limit(1);
  if (
    !project?.organisationId ||
    (input.organisationId !== undefined &&
      project.organisationId !== input.organisationId) ||
    (input.audienceOrganisationIds?.some(
      (organisationId) => organisationId !== project.organisationId,
    ) ??
      false)
  )
    throw new HTTPException(422, {
      message: "Auto-accept project is unavailable for this organisation",
    });
}

/** Validate every configured portal audience while the caller holds the request-type lock. */
async function requireAutoAcceptAudienceBinding(
  tx: DbTransaction,
  input: {
    requestTypeId: string;
    autoAccept: boolean;
    workspaceId: string;
    projectId: string | null;
  },
) {
  if (!input.autoAccept) return;
  const audience = await tx
    .select({
      organisationId: schema.organisationRequestTypeTable.organisationId,
    })
    .from(schema.organisationRequestTypeTable)
    .where(
      eq(
        schema.organisationRequestTypeTable.requestTypeId,
        input.requestTypeId,
      ),
    )
    .for("share");
  await requireAutoAcceptProject(tx, {
    ...input,
    audienceOrganisationIds: audience.map((row) => row.organisationId),
  });
}

export async function publishRequestType(id: string, actorId: string) {
  return db.transaction(async (tx) => {
    const [type] = await tx
      .select()
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, id))
      .for("update")
      .limit(1);
    if (!type)
      throw new HTTPException(404, { message: "Request type not found" });
    const formSchema = type.formSchema as FormSchema;
    await requireAutoAcceptAudienceBinding(tx, {
      requestTypeId: id,
      autoAccept: type.autoAccept,
      workspaceId: type.workspaceId,
      projectId: type.defaultProjectId,
    });
    const defects = validateFormSchema(
      formSchema,
      new Set(["title", "description", "priority"]),
    );
    const supportedNativeFields = new Set(["title", "description", "priority"]);
    const unsupportedMapping = formSchema.fields.some(
      (field) =>
        field.mapsTo !== undefined &&
        !supportedNativeFields.has(field.mapsTo.field),
    );
    const requiredFileField = formSchema.fields.some(
      (field) => field.type === "file" && field.required === true,
    );
    if (
      defects.length ||
      unsupportedMapping ||
      requiredFileField ||
      !hasValidTitleMapping(formSchema)
    ) {
      throw new HTTPException(422, {
        message: "Request type form is not publishable",
      });
    }
    const [workItemType] = await tx
      .select({ id: schema.workItemTypeTable.id })
      .from(schema.workItemTypeTable)
      .where(
        and(
          eq(schema.workItemTypeTable.id, type.workItemTypeId),
          eq(schema.workItemTypeTable.workspaceId, type.workspaceId),
        ),
      )
      .limit(1);
    if (!workItemType)
      throw new HTTPException(422, {
        message: "Request type work-item type is unavailable",
      });
    if (type.defaultProjectId) {
      const [project] = await tx
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(
          and(
            eq(schema.projectTable.id, type.defaultProjectId),
            eq(schema.projectTable.workspaceId, type.workspaceId),
            isNull(schema.projectTable.deletedAt),
            isNull(schema.projectTable.archivedAt),
          ),
        )
        .limit(1);
      if (!project)
        throw new HTTPException(422, {
          message: "Request type project is unavailable",
        });
    }
    const [latest] = await tx
      .select({ number: schema.requestTypeVersionTable.number })
      .from(schema.requestTypeVersionTable)
      .where(eq(schema.requestTypeVersionTable.requestTypeId, id))
      .orderBy(desc(schema.requestTypeVersionTable.number))
      .limit(1);
    const [version] = await tx
      .insert(schema.requestTypeVersionTable)
      .values({
        workspaceId: type.workspaceId,
        requestTypeId: id,
        number: (latest?.number ?? 0) + 1,
        formSchema,
        workItemTypeId: type.workItemTypeId,
        defaultProjectId: type.defaultProjectId,
        slaPolicyId: type.slaPolicyId,
        autoAccept: type.autoAccept,
        defaultAssigneeId: type.defaultAssigneeId,
      })
      .returning();
    if (!version)
      throw new HTTPException(500, {
        message: "Could not publish request type",
      });
    const [published] = await tx
      .update(schema.requestTypeTable)
      .set({
        published: true,
        version: type.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.requestTypeTable.id, id),
          eq(schema.requestTypeTable.version, type.version),
        ),
      )
      .returning();
    if (!published)
      throw new HTTPException(409, {
        message: "Request type changed while publishing",
      });
    await appendAuditLog(tx, {
      actorId,
      actorType: "person",
      workspaceId: type.workspaceId,
      action: "request_type.published",
      entityType: "request_type",
      entityId: type.id,
      after: {
        requestTypeId: type.id,
        versionId: version.id,
        version: version.number,
      },
    });
    return { requestType: published, version };
  });
}

export async function setRequestTypePublished(
  id: string,
  published: boolean,
  actorId: string,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, id))
      .for("update")
      .limit(1);
    if (!current)
      throw new HTTPException(404, { message: "Request type not found" });
    if (current.published === published) return current;
    if (published) {
      const [latest] = await tx
        .select()
        .from(schema.requestTypeVersionTable)
        .where(eq(schema.requestTypeVersionTable.requestTypeId, id))
        .orderBy(desc(schema.requestTypeVersionTable.number))
        .limit(1)
        .for("share");
      if (latest)
        await requireAutoAcceptAudienceBinding(tx, {
          requestTypeId: id,
          autoAccept: latest.autoAccept,
          workspaceId: current.workspaceId,
          projectId: latest.defaultProjectId,
        });
    }
    const [row] = await tx
      .update(schema.requestTypeTable)
      .set({
        published,
        version: sql`${schema.requestTypeTable.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.requestTypeTable.id, id),
          eq(schema.requestTypeTable.version, current.version),
        ),
      )
      .returning();
    if (!row)
      throw new HTTPException(404, { message: "Request type not found" });
    await appendAuditLog(tx, {
      actorId,
      actorType: "person",
      workspaceId: row.workspaceId,
      action: published ? "request_type.published" : "request_type.unpublished",
      entityType: "request_type",
      entityId: row.id,
      before: { published: current.published, version: current.version },
      after: { published, version: row.version },
    });
    return row;
  });
}

export async function deleteRequestType(id: string, actorId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, id))
      .for("update")
      .limit(1);
    if (!row)
      throw new HTTPException(404, { message: "Request type not found" });
    if (row.published)
      throw new HTTPException(409, {
        message: "Unpublish this request type before deleting it",
      });
    const [submission] = await tx
      .select({ id: schema.submissionTable.id })
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.requestTypeId, id))
      .limit(1);
    if (submission)
      throw new HTTPException(409, {
        message: "Request type has submission history and cannot be deleted",
      });
    await tx
      .delete(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, id));
    await appendAuditLog(tx, {
      actorId,
      actorType: "person",
      workspaceId: row.workspaceId,
      action: "request_type.deleted",
      entityType: "request_type",
      entityId: row.id,
      before: { requestTypeId: row.id, workspaceId: row.workspaceId },
    });
    return { deleted: true as const };
  });
}

export async function portalIdentity(userId: string) {
  const [row] = await db
    .select({
      personId: schema.personTable.id,
      organisationId: schema.personTable.organisationId,
      side: schema.personTable.side,
    })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.side, "customer"),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
  if (!row)
    throw new HTTPException(404, { message: "Portal account not found" });
  return row;
}

export async function portalCatalogue(organisationId: string, query = "") {
  const latestPublished = db
    .select({
      requestTypeId: schema.requestTypeVersionTable.requestTypeId,
      number:
        sql<number>`max(${sql.identifier("request_type_version")}.${sql.identifier("number")})`.as(
          "number",
        ),
    })
    .from(schema.requestTypeVersionTable)
    .groupBy(schema.requestTypeVersionTable.requestTypeId)
    .as("latest_published");
  const rows = await db
    .select({
      type: schema.requestTypeTable,
      workspaceId: schema.requestTypeTable.workspaceId,
      version: schema.requestTypeVersionTable,
    })
    .from(schema.organisationRequestTypeTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(
        schema.requestTypeTable.id,
        schema.organisationRequestTypeTable.requestTypeId,
      ),
    )
    .innerJoin(
      latestPublished,
      eq(latestPublished.requestTypeId, schema.requestTypeTable.id),
    )
    .innerJoin(
      schema.requestTypeVersionTable,
      and(
        eq(
          schema.requestTypeVersionTable.requestTypeId,
          latestPublished.requestTypeId,
        ),
        eq(
          schema.requestTypeVersionTable.number,
          sql<number>`${sql.identifier("latest_published")}.${sql.identifier("number")}`,
        ),
      ),
    )
    .where(
      and(
        eq(schema.organisationRequestTypeTable.organisationId, organisationId),
        eq(schema.requestTypeTable.published, true),
        eq(schema.requestTypeTable.customerVisible, true),
      ),
    );
  const workspaceIds = [...new Set(rows.map((row) => row.workspaceId))];
  const [[instance], workspaceFlags] = await Promise.all([
    db
      .select({
        enabled: schema.instanceFeatureFlagTable.enabled,
        locked: schema.instanceFeatureFlagTable.locked,
      })
      .from(schema.instanceFeatureFlagTable)
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.intake"))
      .limit(1),
    workspaceIds.length
      ? db
          .select({
            workspaceId: schema.workspaceFeatureFlagTable.workspaceId,
            enabled: schema.workspaceFeatureFlagTable.enabled,
          })
          .from(schema.workspaceFeatureFlagTable)
          .where(
            inArray(schema.workspaceFeatureFlagTable.workspaceId, workspaceIds),
          )
      : Promise.resolve([]),
  ]);
  const enabledWorkspaceIds = new Set(
    workspaceIds.filter(
      (workspaceId) =>
        resolveFeatureFlag({
          feature: "feature.intake",
          instance: instance ?? null,
          workspace:
            workspaceFlags.find((flag) => flag.workspaceId === workspaceId)
              ?.enabled ?? null,
        }).enabled,
    ),
  );
  const activeRows = rows.filter((row) =>
    enabledWorkspaceIds.has(row.workspaceId),
  );
  const ordered = activeRows.sort(
    (a, b) =>
      a.type.position - b.type.position || a.type.id.localeCompare(b.type.id),
  );
  const groupOrder = new Map<string, number>();
  for (const row of ordered) {
    const current = groupOrder.get(row.type.group);
    if (current === undefined || row.type.position < current)
      groupOrder.set(row.type.group, row.type.position);
  }
  return ordered
    .filter(({ type }) =>
      `${type.name} ${type.description ?? ""} ${type.group}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        (groupOrder.get(a.type.group) ?? 0) -
          (groupOrder.get(b.type.group) ?? 0) ||
        a.type.position - b.type.position ||
        a.type.id.localeCompare(b.type.id),
    );
}

export async function createSubmission(input: {
  userId: string;
  key: string;
  formData: Record<string, unknown>;
  customerVisibility?: "private" | "organisation";
}) {
  const identity = await portalIdentity(input.userId);
  const rows = await portalCatalogue(identity.organisationId);
  const selected = rows.find((row) => row.type.key === input.key);
  if (!selected)
    throw new HTTPException(404, { message: "Request type not found" });
  const submission = await db.transaction(async (tx) => {
    const [currentType] = await tx
      .select({
        type: schema.requestTypeTable,
        version: schema.requestTypeVersionTable,
      })
      .from(schema.organisationRequestTypeTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(
          schema.requestTypeTable.id,
          schema.organisationRequestTypeTable.requestTypeId,
        ),
      )
      .innerJoin(
        schema.requestTypeVersionTable,
        eq(
          schema.requestTypeVersionTable.requestTypeId,
          schema.requestTypeTable.id,
        ),
      )
      .where(
        and(
          eq(
            schema.organisationRequestTypeTable.organisationId,
            identity.organisationId,
          ),
          eq(schema.requestTypeTable.key, input.key),
          eq(schema.requestTypeTable.published, true),
          eq(schema.requestTypeTable.customerVisible, true),
          eq(schema.requestTypeVersionTable.number, selected.version.number),
        ),
      )
      .for("update", {
        of: [schema.requestTypeTable, schema.organisationRequestTypeTable],
      })
      .limit(1);
    if (!currentType || currentType.type.id !== selected.type.id)
      throw new HTTPException(404, { message: "Request type not found" });
    const [latestVersion] = await tx
      .select({ number: schema.requestTypeVersionTable.number })
      .from(schema.requestTypeVersionTable)
      .where(
        eq(schema.requestTypeVersionTable.requestTypeId, currentType.type.id),
      )
      .orderBy(desc(schema.requestTypeVersionTable.number))
      .limit(1);
    if (latestVersion?.number !== currentType.version.number)
      throw new HTTPException(409, {
        message: "Request type changed; reload the catalogue",
      });
    const version = currentType.version;
    await requireAutoAcceptProject(tx, {
      autoAccept: version.autoAccept,
      workspaceId: selected.workspaceId,
      projectId: version.defaultProjectId,
      organisationId: identity.organisationId,
    });
    const [instanceFlag] = await tx
      .select()
      .from(schema.instanceFeatureFlagTable)
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.intake"))
      .for("share")
      .limit(1);
    const [workspaceFlag] = await tx
      .select()
      .from(schema.workspaceFeatureFlagTable)
      .where(
        and(
          eq(
            schema.workspaceFeatureFlagTable.workspaceId,
            selected.workspaceId,
          ),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.intake"),
        ),
      )
      .for("share")
      .limit(1);
    if (
      !resolveFeatureFlag({
        feature: "feature.intake",
        instance: instanceFlag ?? null,
        workspace: workspaceFlag?.enabled ?? null,
      }).enabled
    )
      throw new HTTPException(404, { message: "Request type not found" });
    const errors = validateSubmissionData(
      version.formSchema as FormSchema,
      input.formData as Record<string, FormValue>,
    );
    if (errors.length)
      throw new HTTPException(422, {
        message: "Form answers do not match this request type",
      });
    const [organisation] = await tx
      .select({
        defaultCustomerVisibility:
          schema.organisationTable.defaultCustomerVisibility,
      })
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.id, identity.organisationId))
      .limit(1);
    if (!organisation)
      throw new HTTPException(404, {
        message: "Customer organisation not found",
      });
    const visibility = currentType.type.forcePrivate
      ? "private"
      : (input.customerVisibility ??
        (organisation.defaultCustomerVisibility as "private" | "organisation"));
    const [created] = await tx
      .insert(schema.submissionTable)
      .values({
        organisationId: identity.organisationId,
        requesterId: identity.personId,
        requestTypeId: currentType.type.id,
        requestTypeVersionId: version.id,
        formData: input.formData,
        customerVisibility: visibility,
        submittedAt: new Date(),
        state: "new",
      })
      .returning();
    if (!created)
      throw new HTTPException(500, { message: "Could not create submission" });
    await tx.insert(schema.requestParticipantTable).values({
      submissionId: created.id,
      personId: identity.personId,
      addedBy: identity.personId,
    });
    await appendAuditLog(tx, {
      actorId: identity.personId,
      actorType: "person",
      workspaceId: selected.workspaceId,
      organisationId: identity.organisationId,
      action: "submission.received",
      entityType: "submission",
      entityId: created.id,
      after: { number: created.number, requestTypeId: selected.type.id },
    });
    await enqueueOutboxEvent(tx, {
      id: `evt_${createId()}`,
      kind: "submission.received",
      occurredAt: created.createdAt.toISOString(),
      actor: { type: "person", id: identity.personId, name: "Customer" },
      scope: eventScope({
        workspaceId: selected.workspaceId,
        organisationId: identity.organisationId,
        projectId: null,
      }),
      payload: {
        ref: formatSubmissionReference(created.number),
        requestTypeId: currentType.type.id,
        organisationId: identity.organisationId,
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    if (version.autoAccept) {
      const item = await convertSubmissionInTransaction(
        tx,
        created,
        selected.workspaceId,
        {
          id: null,
          type: "system",
          name: "Request type auto-accept",
        },
        version.defaultProjectId,
        version.workItemTypeId,
        version.slaPolicyId,
        version.defaultAssigneeId,
      );
      return { ...created, state: "accepted", workItemId: item.id };
    }
    return created;
  });
  return { ...submission, ref: formatSubmissionReference(submission.number) };
}

function paragraphDocument(text: string) {
  return {
    type: "doc",
    content: text
      ? text.split("\n").map((line) => ({
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : [],
        }))
      : [{ type: "paragraph" }],
  };
}

async function convertSubmissionInTransaction(
  tx: DbTransaction,
  submission: typeof schema.submissionTable.$inferSelect,
  workspaceId: string,
  actor: {
    id: string | null;
    type: "person" | "system";
    name: string;
  },
  projectId: string | null,
  typeId: string,
  requestSlaPolicyId: string | null,
  defaultAssigneeId: string | null,
) {
  const actorId = actor.id;
  const actorName =
    actor.type === "person"
      ? ((
          await tx
            .select({ displayName: schema.personTable.displayName })
            .from(schema.personTable)
            .where(eq(schema.personTable.id, actor.id ?? ""))
            .limit(1)
        )[0]?.displayName ?? actor.name)
      : actor.name;
  if (!projectId)
    throw new HTTPException(422, {
      message:
        "A destination project must be selected before accepting this submission",
    });
  const [project] = await tx
    .select()
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        eq(schema.projectTable.workspaceId, workspaceId),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    // Match the counter UPDATE's lock mode so concurrent acceptors serialize without upgrades.
    .for("no key update")
    .limit(1);
  if (!project || project.organisationId !== submission.organisationId)
    throw new HTTPException(422, {
      message: "Destination project is unavailable for this organisation",
    });
  const [version] = await tx
    .select()
    .from(schema.requestTypeVersionTable)
    .where(
      eq(schema.requestTypeVersionTable.id, submission.requestTypeVersionId),
    )
    .limit(1);
  if (!version)
    throw new HTTPException(409, {
      message: "Submitted form version is unavailable",
    });
  // IQ-7 treats the snapshotted project and type as prefilled suggestions. The form
  // mapping/version remains pinned; the triager's chosen target type must be live in
  // this workspace, and the chosen project must be live and belong to the requester org.
  const [type] = await tx
    .select()
    .from(schema.workItemTypeTable)
    .where(
      and(
        eq(schema.workItemTypeTable.id, typeId),
        eq(schema.workItemTypeTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!type)
    throw new HTTPException(422, {
      message: "The submitted work-item type is unavailable",
    });
  const [state] = await tx
    .select()
    .from(schema.stateTable)
    .where(
      and(
        eq(schema.stateTable.projectId, project.id),
        eq(schema.stateTable.isDefault, true),
      ),
    )
    .limit(1);
  if (!state)
    throw new HTTPException(422, {
      message: "Destination project has no default state",
    });
  const form = version.formSchema as FormSchema;
  const data = submission.formData as Record<string, unknown>;
  const mappedFields = translateMapsTo(form, data as Record<string, FormValue>);
  const title =
    typeof mappedFields.title === "string" ? mappedFields.title.trim() : "";
  if (!title || title.length > 500)
    throw new HTTPException(422, {
      message: "Submission title is missing or too long",
    });
  const unmapped = renderUnmappedIntoDescription(
    form,
    data as Record<string, FormValue>,
  );
  const description = [
    mappedFields.description == null ? "" : String(mappedFields.description),
    unmapped,
  ]
    .filter(Boolean)
    .join("\n\n");
  const mappedPriority = mappedFields.priority ?? null;
  if (
    mappedPriority !== null &&
    mappedPriority !== undefined &&
    !["low", "medium", "high", "urgent"].includes(String(mappedPriority))
  )
    throw new HTTPException(422, {
      message: "Mapped priority value is unsupported",
    });
  const messages = await tx
    .select()
    .from(schema.submissionMessageTable)
    .where(eq(schema.submissionMessageTable.submissionId, submission.id))
    .orderBy(
      asc(schema.submissionMessageTable.createdAt),
      asc(schema.submissionMessageTable.id),
    );
  const firstResponseAt =
    messages.find((message) => message.actorType === "triager")?.createdAt ??
    null;
  const [workspace] = await findWorkspaceDefaultSlaPolicyQuery(tx, workspaceId);
  if (!workspace)
    throw new HTTPException(409, {
      message: "Submission workspace is unavailable",
    });
  const policyId =
    type.slaPolicyId ??
    requestSlaPolicyId ??
    project.slaPolicyId ??
    workspace.slaPolicyId;
  if (
    policyId &&
    !(await findWorkspaceOwnedSlaPolicyQuery(tx, policyId, workspaceId))[0]
  )
    throw new HTTPException(422, {
      message: "Submission SLA policy is unavailable",
    });
  const [policyVersion] = policyId
    ? await findEffectiveSlaPolicyVersionQuery(
        tx,
        workspaceId,
        policyId,
        submission.createdAt,
      )
    : [];
  let eligibleAssigneeId: string | null = null;
  if (defaultAssigneeId) {
    const [person] = await tx
      .select({
        id: schema.personTable.id,
        active: schema.personTable.active,
        side: schema.personTable.side,
      })
      .from(schema.personTable)
      .innerJoin(
        schema.membershipTable,
        eq(schema.membershipTable.personId, schema.personTable.id),
      )
      .where(
        and(
          eq(schema.personTable.id, defaultAssigneeId),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      )
      .limit(1);
    if (person?.active && person.side === "staff")
      eligibleAssigneeId = person.id;
  }
  const number = await claimWorkItemNumber(project.id, tx);
  const now = new Date();
  const [item] = await tx
    .insert(schema.workItemTable)
    .values({
      projectId: project.id,
      workspaceId,
      typeId: type.id,
      number,
      key: `${project.slug}-${number}`,
      title,
      description: paragraphDocument(description),
      stateId: state.id,
      priority: mappedPriority as "low" | "medium" | "high" | "urgent" | null,
      assigneeId: eligibleAssigneeId,
      requesterId: submission.requesterId,
      customerVisibility: submission.customerVisibility,
      slaStartedAt: submission.createdAt,
      slaPolicyVersionId: policyVersion?.id ?? null,
      firstResponseAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!item)
    throw new HTTPException(500, { message: "Could not convert submission" });
  await recordWorkItemActivity(tx, [
    {
      workspaceId,
      workItemId: item.id,
      actorId,
      actorType: actor.type,
      verb: "created",
      payload: { key: item.key, title: item.title },
    },
  ]);
  await recordWorkItemEvent(tx, {
    kind: "work_item.created",
    workItemId: item.id,
    key: item.key,
    workspaceId,
    projectId: project.id,
    actorId,
    actorType: actor.type,
    actorName,
    customerVisible: true,
    payload: {
      key: item.key,
      url: `/agent/work-items/${encodeURIComponent(item.key)}`,
      typeId: item.typeId,
      stateId: item.stateId,
      requesterId: item.requesterId,
      source: "portal",
    },
  });
  for (const message of messages)
    await tx.insert(schema.commentTable).values({
      workspaceId,
      workItemId: item.id,
      authorId: message.authorId,
      actorType: "person",
      body: paragraphDocument(message.body),
      visibility: "public",
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
    });
  await tx
    .update(schema.attachmentTable)
    .set({ submissionId: null, workItemId: item.id })
    .where(eq(schema.attachmentTable.submissionId, submission.id));
  await tx
    .update(schema.requestParticipantTable)
    .set({ submissionId: null, workItemId: item.id })
    .where(eq(schema.requestParticipantTable.submissionId, submission.id));
  await tx
    .insert(schema.watcherTable)
    .values({
      workItemId: item.id,
      personId: submission.requesterId,
      source: "implicit",
    })
    .onConflictDoNothing();
  const [accepted] = await tx
    .update(schema.submissionTable)
    .set({
      state: "accepted",
      workItemId: item.id,
      updatedAt: now,
      version: submission.version + 1,
      claimedBy: submission.claimedBy ?? actorId,
      claimedAt: submission.claimedAt ?? now,
    })
    .where(
      and(
        eq(schema.submissionTable.id, submission.id),
        eq(schema.submissionTable.version, submission.version),
        inArray(schema.submissionTable.state, ["new", "clarifying"]),
      ),
    )
    .returning();
  if (!accepted)
    throw new HTTPException(409, {
      message: "Submission changed before it could be accepted",
    });
  await appendAuditLog(tx, {
    actorId,
    actorType: actor.type,
    workspaceId,
    organisationId: submission.organisationId,
    action: "submission.accepted",
    entityType: "submission",
    entityId: submission.id,
    after: {
      ref: formatSubmissionReference(submission.number),
      workItemKey: item.key,
    },
  });
  await enqueueOutboxEvent(tx, {
    id: `evt_${createId()}`,
    kind: "submission.accepted",
    occurredAt: now.toISOString(),
    actor: { type: actor.type, id: actorId, name: actorName },
    scope: eventScope({
      workspaceId,
      organisationId: submission.organisationId,
      projectId,
    }),
    payload: {
      ref: formatSubmissionReference(submission.number),
      workItemKey: item.key,
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
  return item;
}

export async function acceptSubmission(
  ref: string,
  workspaceId: string,
  actorId: string,
  projectId: string,
  typeId: string,
) {
  const number = parseSubmissionReference(ref);
  if (number === null)
    throw new HTTPException(404, { message: "Submission not found" });
  // Claim is deliberately committed before destination validation. IQ-16a defines starting
  // acceptance as triage action even if stale configuration later makes conversion fail.
  await claimSubmission(ref, workspaceId, actorId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        submission: schema.submissionTable,
        workspaceId: schema.requestTypeTable.workspaceId,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .where(
        and(
          eq(schema.submissionTable.number, number),
          eq(schema.requestTypeTable.workspaceId, workspaceId),
        ),
      )
      .for("update", { of: schema.submissionTable })
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Submission not found" });
    if (row.submission.state !== "new" && row.submission.state !== "clarifying")
      throw new HTTPException(409, { message: "Submission is no longer open" });
    const [snapshot] = await tx
      .select()
      .from(schema.requestTypeVersionTable)
      .where(
        eq(
          schema.requestTypeVersionTable.id,
          row.submission.requestTypeVersionId,
        ),
      )
      .limit(1);
    if (!snapshot)
      throw new HTTPException(409, {
        message: "Submitted form version is unavailable",
      });
    const item = await convertSubmissionInTransaction(
      tx,
      row.submission,
      workspaceId,
      { id: actorId, type: "person", name: "Staff" },
      projectId,
      typeId,
      snapshot.slaPolicyId,
      snapshot.defaultAssigneeId,
    );
    return { ref, state: "accepted" as const, workItem: item };
  });
}

export async function markSubmissionDuplicate(
  ref: string,
  workspaceId: string,
  actorId: string,
  workItemId: string,
) {
  const number = parseSubmissionReference(ref);
  if (number === null)
    throw new HTTPException(404, { message: "Submission not found" });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        submission: schema.submissionTable,
        workspaceId: schema.requestTypeTable.workspaceId,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .where(
        and(
          eq(schema.submissionTable.number, number),
          eq(schema.requestTypeTable.workspaceId, workspaceId),
        ),
      )
      .for("update", { of: schema.submissionTable })
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Submission not found" });
    if (row.submission.state !== "new" && row.submission.state !== "clarifying")
      throw new HTTPException(409, { message: "Submission is no longer open" });
    const [target] = await tx
      .select({ item: schema.workItemTable, project: schema.projectTable })
      .from(schema.workItemTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.projectTable.id, schema.workItemTable.projectId),
      )
      .where(
        and(
          eq(schema.workItemTable.id, workItemId),
          eq(schema.workItemTable.workspaceId, workspaceId),
          isNull(schema.workItemTable.deletedAt),
          isNull(schema.workItemTable.archivedAt),
        ),
      )
      .limit(1);
    if (
      !target ||
      target.project.organisationId !== row.submission.organisationId
    )
      throw new HTTPException(404, { message: "Work item not found" });
    const now = new Date();
    const [updated] = await tx
      .update(schema.submissionTable)
      .set({
        state: "duplicate",
        workItemId,
        claimedBy: row.submission.claimedBy ?? actorId,
        claimedAt: row.submission.claimedAt ?? now,
        version: row.submission.version + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.submissionTable.id, row.submission.id),
          eq(schema.submissionTable.version, row.submission.version),
          inArray(schema.submissionTable.state, ["new", "clarifying"]),
        ),
      )
      .returning();
    if (!updated)
      throw new HTTPException(409, {
        message: "Submission changed before it could be linked",
      });
    await appendAuditLog(tx, {
      actorId,
      actorType: "person",
      workspaceId,
      organisationId: row.submission.organisationId,
      action: "submission.duplicate",
      entityType: "submission",
      entityId: row.submission.id,
      after: { ref, workItemId: target.item.id, workItemKey: target.item.key },
    });
    await tx
      .insert(schema.watcherTable)
      .values({
        workItemId: target.item.id,
        personId: row.submission.requesterId,
        source: "implicit",
      })
      .onConflictDoNothing();
    return { ref, state: updated.state, workItem: target.item };
  });
}

export async function findSubmission(
  ref: string,
  workspaceId?: string,
  requesterId?: string,
) {
  const number = /^SUB-([1-9]\d{0,9})$/u.exec(ref)?.[1];
  if (!number)
    throw new HTTPException(404, { message: "Submission not found" });
  const [row] = await db
    .select({
      submission: schema.submissionTable,
      workspaceId: schema.requestTypeTable.workspaceId,
      requestType: schema.requestTypeTable,
      version: schema.requestTypeVersionTable,
    })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .innerJoin(
      schema.requestTypeVersionTable,
      eq(
        schema.requestTypeVersionTable.id,
        schema.submissionTable.requestTypeVersionId,
      ),
    )
    .where(
      and(
        eq(schema.submissionTable.number, Number(number)),
        ...(workspaceId
          ? [eq(schema.requestTypeTable.workspaceId, workspaceId)]
          : []),
        ...(requesterId
          ? [eq(schema.submissionTable.requesterId, requesterId)]
          : []),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Submission not found" });
  const storedMessages = await db
    .select()
    .from(schema.submissionMessageTable)
    .where(eq(schema.submissionMessageTable.submissionId, row.submission.id))
    .orderBy(
      asc(schema.submissionMessageTable.createdAt),
      asc(schema.submissionMessageTable.id),
    );
  let messages = storedMessages.map((message) => ({
    ...message,
    createdAt: message.createdAt.toISOString(),
  }));
  if (row.submission.state === "accepted" && row.submission.workItemId) {
    const comments = await db
      .select()
      .from(schema.commentTable)
      .where(
        and(
          eq(schema.commentTable.workItemId, row.submission.workItemId),
          eq(schema.commentTable.visibility, "public"),
          isNull(schema.commentTable.deletedAt),
        ),
      )
      .orderBy(asc(schema.commentTable.createdAt), asc(schema.commentTable.id));
    const existing = new Set(
      storedMessages.map(
        (message) =>
          `${message.authorId ?? ""}/${message.createdAt.toISOString()}`,
      ),
    );
    const transferred = comments
      .filter(
        (comment) =>
          !existing.has(
            `${comment.authorId ?? ""}/${comment.createdAt.toISOString()}`,
          ),
      )
      .map((comment) => ({
        id: comment.id,
        submissionId: row.submission.id,
        authorId: comment.authorId ?? "",
        actorType: comment.actorType,
        body: extractDocumentText(comment.body),
        createdAt: comment.createdAt.toISOString(),
      }));
    messages = [...messages, ...transferred].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }
  return { ...row, ref, messages };
}

export async function findPortalSubmission(ref: string, requesterId: string) {
  const row = await findSubmission(ref, undefined, requesterId);
  const formSchema = row.version.formSchema as FormSchema;
  const fields = visibleFields(
    formSchema,
    row.submission.formData as Record<string, FormValue>,
  ).map((field) => ({
    key: field.key,
    type: field.type,
    label: field.label,
    multiple: field.multiple,
  }));
  let workItem: {
    title: string;
    description: string;
    state: string;
    priority: string | null;
  } | null = null;
  if (row.submission.workItemId) {
    const [item] = await db
      .select({
        title: schema.workItemTable.title,
        description: schema.workItemTable.description,
        state: schema.stateTemplateTable.name,
        priority: schema.workItemTable.priority,
      })
      .from(schema.workItemTable)
      .innerJoin(
        schema.stateTable,
        eq(schema.stateTable.id, schema.workItemTable.stateId),
      )
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTemplateTable.id, schema.stateTable.stateTemplateId),
      )
      .where(
        and(
          eq(schema.workItemTable.id, row.submission.workItemId),
          eq(schema.workItemTable.requesterId, requesterId),
          isNull(schema.workItemTable.deletedAt),
        ),
      )
      .limit(1);
    if (item)
      workItem = {
        ...item,
        description: extractDocumentText(item.description),
      };
  }
  return {
    ref: row.ref,
    submission: {
      state: row.submission.state,
      formData: row.submission.formData as Record<string, unknown>,
      customerVisibility: row.submission.customerVisibility,
      createdAt: row.submission.createdAt.toISOString(),
    },
    canWithdraw:
      (row.submission.state === "new" ||
        row.submission.state === "clarifying") &&
      row.submission.claimedBy === null,
    requestType: {
      name: row.requestType.name,
      description: row.requestType.description,
      icon: row.requestType.icon,
      group: row.requestType.group,
    },
    version: { formSchema: { fields } },
    workItem,
    messages: row.messages.map((message) => ({
      id: message.id,
      actorType: message.actorType,
      body: message.body,
      createdAt: message.createdAt,
    })),
  };
}

function extractDocumentText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as { text?: unknown; content?: unknown[] };
  if (typeof node.text === "string") return node.text;
  return Array.isArray(node.content)
    ? node.content.map(extractDocumentText).filter(Boolean).join("\n")
    : "";
}

type SubmissionPageCursor = { scope: string; createdAt: string; id: string };

function decodeSubmissionCursor(cursor: string | undefined, scope: string) {
  if (!cursor) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as SubmissionPageCursor;
    if (
      decoded.scope !== scope ||
      !Number.isFinite(Date.parse(decoded.createdAt)) ||
      typeof decoded.id !== "string"
    )
      throw new Error();
    return decoded;
  } catch {
    throw new HTTPException(400, { message: "Invalid submission cursor" });
  }
}

function encodeSubmissionCursor(scope: string, createdAt: Date, id: string) {
  return Buffer.from(
    JSON.stringify({ scope, createdAt: createdAt.toISOString(), id }),
  ).toString("base64url");
}

export async function listSubmissions(
  workspaceId: string,
  states?: string[],
  cursor?: string,
  limit = 50,
) {
  const visibleStates = states?.length ? states : ["new", "clarifying"];
  const scope = `staff:${workspaceId}:${[...visibleStates].sort().join(",")}:limit:${limit}`;
  const decoded = decodeSubmissionCursor(cursor, scope);
  const conditions = [
    eq(schema.requestTypeTable.workspaceId, workspaceId),
    inArray(schema.submissionTable.state, visibleStates),
    ...(decoded
      ? [
          or(
            gt(schema.submissionTable.createdAt, new Date(decoded.createdAt)),
            and(
              eq(schema.submissionTable.createdAt, new Date(decoded.createdAt)),
              gt(schema.submissionTable.id, decoded.id),
            ),
          ),
        ]
      : []),
  ];
  const rows = await db
    .select({
      submission: schema.submissionTable,
      requestType: schema.requestTypeTable,
      version: schema.requestTypeVersionTable,
      requester: schema.personTable,
      organisation: schema.organisationTable,
    })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .innerJoin(
      schema.requestTypeVersionTable,
      eq(
        schema.requestTypeVersionTable.id,
        schema.submissionTable.requestTypeVersionId,
      ),
    )
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.submissionTable.requesterId),
    )
    .innerJoin(
      schema.organisationTable,
      eq(schema.organisationTable.id, schema.submissionTable.organisationId),
    )
    .where(and(...conditions))
    .orderBy(
      asc(schema.submissionTable.createdAt),
      asc(schema.submissionTable.id),
    )
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeSubmissionCursor(
          scope,
          last.submission.createdAt,
          last.submission.id,
        )
      : null;
  const [totalRow] = await db
    .select({ value: count() })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .where(
      and(
        eq(schema.requestTypeTable.workspaceId, workspaceId),
        inArray(schema.submissionTable.state, visibleStates),
      ),
    );
  return {
    submissions: pageRows.map((row) => {
      const form = row.version.formSchema as FormSchema;
      const titleField = form.fields.find(
        (field) => field.mapsTo?.field === "title",
      );
      const summary = titleField
        ? String(
            (row.submission.formData as Record<string, unknown>)[
              titleField.key
            ] ?? "",
          )
        : "";
      return {
        ...row,
        summary,
        ref: formatSubmissionReference(row.submission.number),
      };
    }),
    page: { nextCursor, hasMore },
    meta: { total: totalRow?.value ?? 0 },
  };
}

export async function listOwnSubmissions(
  userId: string,
  cursor?: string,
  limit = 50,
) {
  const identity = await portalIdentity(userId);
  const scope = `portal:${identity.personId}:limit:${limit}`;
  const decoded = decodeSubmissionCursor(cursor, scope);
  const conditions = [
    eq(schema.submissionTable.requesterId, identity.personId),
    ...(decoded
      ? [
          or(
            lt(schema.submissionTable.createdAt, new Date(decoded.createdAt)),
            and(
              eq(schema.submissionTable.createdAt, new Date(decoded.createdAt)),
              lt(schema.submissionTable.id, decoded.id),
            ),
          ),
        ]
      : []),
  ];
  const rows = await db
    .select({
      submission: schema.submissionTable,
      requestType: schema.requestTypeTable,
    })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .where(and(...conditions))
    .orderBy(
      desc(schema.submissionTable.createdAt),
      desc(schema.submissionTable.id),
    )
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeSubmissionCursor(
          scope,
          last.submission.createdAt,
          last.submission.id,
        )
      : null;
  const [totalRow] = await db
    .select({ value: count() })
    .from(schema.submissionTable)
    .where(eq(schema.submissionTable.requesterId, identity.personId));
  return {
    submissions: pageRows.map((row) => ({
      ...row,
      ref: formatSubmissionReference(row.submission.number),
    })),
    page: { nextCursor, hasMore },
    meta: { total: totalRow?.value ?? 0 },
  };
}

export async function suggestDuplicateWorkItems(
  ref: string,
  workspaceId: string,
) {
  const number = parseSubmissionReference(ref);
  if (number === null)
    throw new HTTPException(404, { message: "Submission not found" });
  const [row] = await db
    .select({
      submission: schema.submissionTable,
      version: schema.requestTypeVersionTable,
    })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeVersionTable,
      eq(
        schema.requestTypeVersionTable.id,
        schema.submissionTable.requestTypeVersionId,
      ),
    )
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .where(
      and(
        eq(schema.submissionTable.number, number),
        eq(schema.requestTypeTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Submission not found" });
  const form = row.version.formSchema as FormSchema;
  const field = form.fields.find((item) => item.mapsTo?.field === "title");
  const title = field
    ? String(
        (row.submission.formData as Record<string, unknown>)[field.key] ?? "",
      ).trim()
    : "";
  if (title.length < 2) return [];
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const score = sql<number>`similarity(${sql.identifier("work_item")}.${sql.identifier("title")}, ${title})`;
  return db
    .select({
      id: schema.workItemTable.id,
      key: schema.workItemTable.key,
      title: schema.workItemTable.title,
      score,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        eq(schema.workItemTable.workspaceId, workspaceId),
        eq(schema.projectTable.organisationId, row.submission.organisationId),
        gt(schema.workItemTable.createdAt, cutoff),
        gt(score, 0.3),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
      ),
    )
    .orderBy(desc(score), desc(schema.workItemTable.createdAt))
    .limit(10);
}

export async function claimSubmission(
  ref: string,
  workspaceId: string,
  actorId: string,
) {
  const number = parseSubmissionReference(ref);
  if (number === null)
    throw new HTTPException(404, { message: "Submission not found" });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        submission: schema.submissionTable,
        workspaceId: schema.requestTypeTable.workspaceId,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .where(
        and(
          eq(schema.submissionTable.number, number),
          eq(schema.requestTypeTable.workspaceId, workspaceId),
        ),
      )
      .for("update", { of: schema.submissionTable })
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Submission not found" });
    if (row.submission.state !== "new" && row.submission.state !== "clarifying")
      throw new HTTPException(409, { message: "Submission is no longer open" });
    if (row.submission.claimedBy && row.submission.claimedBy !== actorId)
      throw new HTTPException(409, {
        message: "Submission is claimed by another triager",
      });
    if (row.submission.claimedBy === actorId && row.submission.claimedAt)
      return {
        id: row.submission.id,
        ref,
        state: row.submission.state,
        claimedBy: row.submission.claimedBy,
        claimedAt: row.submission.claimedAt,
      };
    const [updated] = await tx
      .update(schema.submissionTable)
      .set({
        claimedBy: actorId,
        claimedAt: row.submission.claimedAt ?? new Date(),
        version: row.submission.version + 1,
      })
      .where(
        and(
          eq(schema.submissionTable.id, row.submission.id),
          eq(schema.submissionTable.version, row.submission.version),
        ),
      )
      .returning();
    if (!updated)
      throw new HTTPException(409, {
        message: "Submission changed; reload before acting",
      });
    await appendAuditLog(tx, {
      actorId,
      actorType: "person",
      workspaceId,
      organisationId: row.submission.organisationId,
      action: "submission.claimed",
      entityType: "submission",
      entityId: row.submission.id,
      after: {
        ref,
        claimedBy: actorId,
        claimedAt: updated.claimedAt?.toISOString() ?? null,
      },
    });
    return {
      id: updated.id,
      ref,
      state: updated.state,
      claimedBy: updated.claimedBy,
      claimedAt: updated.claimedAt,
    };
  });
}

export async function postSubmissionMessage(input: {
  ref: string;
  workspaceId?: string;
  requesterId?: string;
  actorId: string;
  actorType: "customer" | "triager";
  body: string;
}) {
  const number = parseSubmissionReference(input.ref);
  if (number === null)
    throw new HTTPException(404, { message: "Submission not found" });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        submission: schema.submissionTable,
        workspaceId: schema.requestTypeTable.workspaceId,
        workItem: schema.workItemTable,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .leftJoin(
        schema.workItemTable,
        eq(schema.workItemTable.id, schema.submissionTable.workItemId),
      )
      .where(
        and(
          eq(schema.submissionTable.number, number),
          ...(input.workspaceId
            ? [eq(schema.requestTypeTable.workspaceId, input.workspaceId)]
            : []),
          ...(input.requesterId
            ? [eq(schema.submissionTable.requesterId, input.requesterId)]
            : []),
        ),
      )
      .for("update", { of: schema.submissionTable })
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Submission not found" });
    if (row.submission.state === "accepted" && input.actorType === "customer") {
      if (!row.workItem)
        throw new HTTPException(409, {
          message: "Accepted work item is unavailable",
        });
      const now = new Date();
      const [comment] = await tx
        .insert(schema.commentTable)
        .values({
          workspaceId: row.workspaceId,
          workItemId: row.workItem.id,
          authorId: input.actorId,
          actorType: "person",
          body: paragraphDocument(input.body),
          visibility: "public",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!comment)
        throw new HTTPException(500, {
          message: "Could not post work-item reply",
        });
      await recordWorkItemEvent(tx, {
        kind: "work_item.commented",
        workItemId: row.workItem.id,
        key: row.workItem.key,
        workspaceId: row.workspaceId,
        projectId: row.workItem.projectId,
        actorId: input.actorId,
        actorType: "person",
        customerVisible: true,
        payload: {
          key: row.workItem.key,
          url: `/portal/submissions/${encodeURIComponent(input.ref)}`,
          commentId: comment.id,
          visibility: "public",
        },
      });
      await appendAuditLog(tx, {
        actorId: input.actorId,
        actorType: "person",
        workspaceId: row.workspaceId,
        organisationId: row.submission.organisationId,
        action: "submission.replied",
        entityType: "submission",
        entityId: row.submission.id,
        after: { number, by: "customer", workItemId: row.workItem.id },
      });
      await enqueueOutboxEvent(tx, {
        id: `evt_${createId()}`,
        kind: "submission.replied",
        occurredAt: now.toISOString(),
        actor: { type: "person", id: input.actorId, name: "Customer" },
        scope: eventScope({
          workspaceId: row.workspaceId,
          organisationId: row.submission.organisationId,
          projectId: row.workItem.projectId,
        }),
        payload: { ref: input.ref, by: "customer" },
        causationId: null,
        depth: 0,
        originAutomationId: null,
      });
      return {
        id: row.submission.id,
        ref: input.ref,
        state: row.submission.state,
        message: {
          id: comment.id,
          authorId: input.actorId,
          actorType: "customer",
          body: input.body,
          createdAt: comment.createdAt,
        },
      };
    }
    const now = new Date();
    const before = row.submission;
    const action = input.actorType === "customer" ? "reply" : "clarify";
    const transitioned = transitionSubmission(
      {
        number,
        state: before.state as never,
        claimedBy: before.claimedBy,
        claimedAt: before.claimedAt,
        clarifyingSince:
          before.state === "clarifying" ? before.updatedAt : null,
        staffMessageCount:
          input.actorType === "triager" && before.claimedBy ? 1 : 0,
      },
      { action, actor: input.actorType, now },
    );
    if (!transitioned.ok)
      throw new HTTPException(409, {
        message: "Submission cannot receive a message in its current state",
      });
    const [message] = await tx
      .insert(schema.submissionMessageTable)
      .values({
        submissionId: before.id,
        authorId: input.actorId,
        actorType: input.actorType,
        body: input.body,
        createdAt: now,
      })
      .returning();
    if (!message)
      throw new HTTPException(500, { message: "Could not post message" });
    const [updated] = await tx
      .update(schema.submissionTable)
      .set({
        state: transitioned.to,
        claimedBy:
          input.actorType === "triager"
            ? (before.claimedBy ?? input.actorId)
            : before.claimedBy,
        claimedAt:
          input.actorType === "triager"
            ? (before.claimedAt ?? now)
            : before.claimedAt,
        version: before.version + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.submissionTable.id, before.id),
          eq(schema.submissionTable.version, before.version),
        ),
      )
      .returning();
    if (!updated)
      throw new HTTPException(409, {
        message: "Submission changed; reload before replying",
      });
    await appendAuditLog(tx, {
      actorId: input.actorId,
      actorType: "person",
      workspaceId: row.workspaceId,
      organisationId: before.organisationId,
      action: "submission.replied",
      entityType: "submission",
      entityId: before.id,
      after: { number, by: input.actorType },
    });
    await enqueueOutboxEvent(tx, {
      id: `evt_${createId()}`,
      kind: "submission.replied",
      occurredAt: now.toISOString(),
      actor: {
        type: "person",
        id: input.actorId,
        name: input.actorType === "customer" ? "Customer" : "Staff",
      },
      scope: eventScope({
        workspaceId: row.workspaceId,
        organisationId: before.organisationId,
        projectId: null,
      }),
      payload: {
        ref: input.ref,
        by: input.actorType === "customer" ? "customer" : "staff",
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    return { id: updated.id, ref: input.ref, state: updated.state, message };
  });
}

export async function withdrawSubmission(ref: string, requesterId: string) {
  const number = parseSubmissionReference(ref);
  if (number === null)
    throw new HTTPException(404, { message: "Submission not found" });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        submission: schema.submissionTable,
        workspaceId: schema.requestTypeTable.workspaceId,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .where(
        and(
          eq(schema.submissionTable.number, number),
          eq(schema.submissionTable.requesterId, requesterId),
        ),
      )
      .for("update", { of: schema.submissionTable })
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Submission not found" });
    const before = row.submission;
    const result = transitionSubmission(
      {
        number,
        state: before.state as never,
        claimedBy: before.claimedBy,
        claimedAt: before.claimedAt,
        clarifyingSince: null,
        staffMessageCount: 0,
      },
      { action: "withdraw", actor: "customer", now: new Date() },
    );
    if (!result.ok)
      throw new HTTPException(409, {
        message:
          result.refusal === "triage_started"
            ? "A triager has already started reviewing this submission"
            : "Submission cannot be withdrawn",
      });
    const [updated] = await tx
      .update(schema.submissionTable)
      .set({
        state: "withdrawn",
        version: before.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.submissionTable.id, before.id),
          eq(schema.submissionTable.version, before.version),
          isNull(schema.submissionTable.claimedBy),
        ),
      )
      .returning();
    if (!updated)
      throw new HTTPException(409, {
        message: "Submission changed; reload before withdrawing",
      });
    await appendAuditLog(tx, {
      actorId: requesterId,
      actorType: "person",
      workspaceId: row.workspaceId,
      organisationId: before.organisationId,
      action: "submission.withdrawn",
      entityType: "submission",
      entityId: before.id,
      after: { number },
    });
    await enqueueOutboxEvent(tx, {
      id: `evt_${createId()}`,
      kind: "submission.withdrawn",
      occurredAt: updated.updatedAt.toISOString(),
      actor: { type: "person", id: requesterId, name: "Customer" },
      scope: eventScope({
        workspaceId: row.workspaceId,
        organisationId: before.organisationId,
        projectId: null,
      }),
      payload: { ref },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    return { ref, state: updated.state, version: updated.version };
  });
}

export async function declineSubmission(
  ref: string,
  workspaceId: string,
  actorId: string,
  reason: string,
) {
  const number = parseSubmissionReference(ref);
  if (number === null)
    throw new HTTPException(404, { message: "Submission not found" });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        submission: schema.submissionTable,
        workspaceId: schema.requestTypeTable.workspaceId,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .where(
        and(
          eq(schema.submissionTable.number, number),
          eq(schema.requestTypeTable.workspaceId, workspaceId),
        ),
      )
      .for("update", { of: schema.submissionTable })
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Submission not found" });
    const now = new Date();
    const before = row.submission;
    const [updated] = await tx
      .update(schema.submissionTable)
      .set({
        state: "declined",
        version: before.version + 1,
        claimedBy: before.claimedBy ?? actorId,
        claimedAt: before.claimedAt ?? now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.submissionTable.id, before.id),
          eq(schema.submissionTable.version, before.version),
          inArray(schema.submissionTable.state, ["new", "clarifying"]),
        ),
      )
      .returning();
    if (!updated)
      throw new HTTPException(409, { message: "Submission is no longer open" });
    const [message] = await tx
      .insert(schema.submissionMessageTable)
      .values({
        submissionId: before.id,
        authorId: actorId,
        actorType: "triager",
        body: reason,
        createdAt: now,
      })
      .returning();
    if (!message)
      throw new HTTPException(500, {
        message: "Could not record decline reason",
      });
    await appendAuditLog(tx, {
      actorId,
      actorType: "person",
      workspaceId,
      organisationId: before.organisationId,
      action: "submission.declined",
      entityType: "submission",
      entityId: before.id,
      after: { number, reason },
    });
    await enqueueOutboxEvent(tx, {
      id: `evt_${createId()}`,
      kind: "submission.declined",
      occurredAt: now.toISOString(),
      actor: { type: "person", id: actorId, name: "Staff" },
      scope: eventScope({
        workspaceId,
        organisationId: before.organisationId,
        projectId: null,
      }),
      payload: { ref, reason },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    return { ref, state: updated.state, reason, message };
  });
}
