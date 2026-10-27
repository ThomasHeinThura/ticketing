import { createId } from "@paralleldrive/cuid2";
import type { FormSchema, FormValue, JsonValue } from "@taskdesk/domain";
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
import {
  type ResolvedIdentity,
  resolveFeatureFlag,
} from "@taskdesk/permissions";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  currentProjectReachPredicate,
  currentWorkspaceReachPredicate,
} from "../database/repositories/identity-scope.repository";
import {
  type DbTransaction,
  enqueueOutboxEvent,
  eventScope,
} from "../events/outbox";
import { workspaceFeatureEnabled } from "../feature-flag/enforce";
import { logTaskDesk } from "../instance/observability/runtime";
import { enqueueNotificationEvent } from "../notification/fanout";
import { resolveSubmissionRepliedRecipients } from "../notification/submission-recipients";
import { resolveProjectSlaPolicyId } from "../project/effective-settings";
import { recordWorkItemActivity } from "../work-item/activity";
import { resolveAssigneeEligibility } from "../work-item/assignee-eligibility";
import { claimWorkItemNumber } from "../work-item/controllers/claim-work-item-number";
import { recordInitialWorkItemFields } from "../work-item/create-initial-fields";
import { recordWorkItemEvent } from "../work-item/native-event";
import {
  findEffectiveSlaPolicyVersionQuery,
  findWorkspaceDefaultSlaPolicyQuery,
  findWorkspaceOwnedSlaPolicyQuery,
} from "../work-item/repository";
import {
  findReopenWindowDays,
  isWithinReopenWindow,
  recordReopenRequested,
  requestCustomerReopen,
} from "../workflow/customer-reopen";
import { appendIntakeAudit } from "./audit";
import {
  applyAcceptedCustomFields,
  customFieldKeyOf,
  loadPortalCustomFields,
  type PortalCustomField,
  refusedCustomFieldMappings,
} from "./custom-field-mapping";
import { suggestDuplicatesForQueueRows } from "./duplicate-suggestions";
import { intakeError } from "./errors";
import {
  lockRequestTypeGroupOrder,
  orderPortalCatalogueGroups,
  synchronizeRequestTypeGroupOrder,
} from "./group-order";
import {
  CLAIMED,
  filtersScope,
  olderThanCutoff,
  type SubmissionListFilters,
  UNCLAIMED,
} from "./list-filters";
import { raisablePriorities } from "./portal-priority";
import { loadPortalSla, type PortalSla } from "./portal-sla";
import {
  type PortalCustomerStatus,
  type PortalStatusWorkItem,
  portalCustomerStatus,
} from "./portal-status";

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

type MaterializedRequestType<T extends { formSchema: unknown }> = Omit<
  T,
  "formSchema"
> & { formSchema: JsonValue };
type MaterializedRequestTypeVersion<T extends { formSchema: unknown }> = Omit<
  T,
  "formSchema"
> & { formSchema: JsonValue };
type MaterializedSubmission<T extends { formData: unknown }> = Omit<
  T,
  "formData"
> & { formData: JsonValue };
type MaterializedWorkItemDescription<T extends { description: unknown }> = Omit<
  T,
  "description"
> & { description: JsonValue | null };

function materializeRequestType<T extends { formSchema: unknown }>(
  row: T,
): MaterializedRequestType<T> {
  return { ...row, formSchema: row.formSchema as JsonValue };
}

function materializeRequestTypeVersion<T extends { formSchema: unknown }>(
  row: T,
): MaterializedRequestTypeVersion<T> {
  return { ...row, formSchema: row.formSchema as JsonValue };
}

function materializeSubmission<T extends { formData: unknown }>(
  row: T,
): MaterializedSubmission<T> {
  return { ...row, formData: row.formData as JsonValue };
}

function materializeWorkItemDescription<T extends { description: unknown }>(
  row: T,
): MaterializedWorkItemDescription<T> {
  return { ...row, description: row.description as JsonValue | null };
}

function materializeSubmissionBundle<
  T extends {
    submission: { formData: unknown };
    requestType: { formSchema: unknown };
    version: { formSchema: unknown };
  },
>(
  row: T,
): Omit<T, "submission" | "requestType" | "version"> & {
  submission: MaterializedSubmission<T["submission"]>;
  requestType: MaterializedRequestType<T["requestType"]>;
  version: MaterializedRequestTypeVersion<T["version"]>;
} {
  return {
    ...row,
    submission: materializeSubmission(row.submission),
    requestType: materializeRequestType(row.requestType),
    version: materializeRequestTypeVersion(row.version),
  };
}

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
  const rows = await db
    .select()
    .from(schema.requestTypeTable)
    .where(eq(schema.requestTypeTable.workspaceId, workspaceId))
    .orderBy(
      asc(schema.requestTypeTable.position),
      asc(schema.requestTypeTable.id),
    );
  return rows.map(materializeRequestType);
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
  return {
    ...materializeRequestType(row),
    versions: versions.map(materializeRequestTypeVersion),
  };
}

export async function createRequestType(
  input: RequestTypeInput,
  actorId: string,
) {
  const row = await db.transaction(async (tx) => {
    await lockRequestTypeGroupOrder(tx, input.workspaceId);
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
    await synchronizeRequestTypeGroupOrder(tx, input.workspaceId);
    await appendIntakeAudit(tx, {
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
  return materializeRequestType(row);
}

export async function updateRequestType(
  id: string,
  input: Partial<RequestTypeInput>,
  version: number,
  actorId: string,
) {
  return db.transaction(async (tx) => {
    const [scope] = await tx
      .select({ workspaceId: schema.requestTypeTable.workspaceId })
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, id))
      .limit(1);
    if (!scope)
      throw new HTTPException(404, { message: "Request type not found" });
    await lockRequestTypeGroupOrder(tx, scope.workspaceId);
    const [current] = await tx
      .select()
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, id))
      .for("update")
      .limit(1);
    if (!current)
      throw new HTTPException(404, { message: "Request type not found" });
    if (
      current.workspaceId !== scope.workspaceId ||
      (input.workspaceId && input.workspaceId !== current.workspaceId)
    )
      throw new HTTPException(409, {
        message: "Request type workspace changed",
      });
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
    await synchronizeRequestTypeGroupOrder(tx, current.workspaceId);
    await appendIntakeAudit(tx, {
      actorId,
      actorType: "person",
      workspaceId: row.workspaceId,
      action: "request_type.updated",
      entityType: "request_type",
      entityId: row.id,
      before: { version: current.version },
      after: { version: row.version, changedFields: Object.keys(input).sort() },
    });
    return materializeRequestType(row);
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
    // CF-11: a form may also collect a customer-visible custom field, mapped as `cf.<key>`.
    const refusedCustomFields = await refusedCustomFieldMappings(tx, {
      workspaceId: type.workspaceId,
      workItemTypeId: type.workItemTypeId,
      form: formSchema,
    });
    const supportedNativeFields = new Set(["title", "description", "priority"]);
    const defects = validateFormSchema(
      formSchema,
      new Set([
        ...supportedNativeFields,
        ...formSchema.fields.flatMap((field) =>
          field.mapsTo &&
          customFieldKeyOf(field.mapsTo.field) !== null &&
          !refusedCustomFields.includes(field.mapsTo.field)
            ? [field.mapsTo.field]
            : [],
        ),
      ]),
    );
    const unsupportedMapping =
      refusedCustomFields.length > 0 ||
      formSchema.fields.some(
        (field) =>
          field.mapsTo !== undefined &&
          customFieldKeyOf(field.mapsTo.field) === null &&
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
        message:
          refusedCustomFields.length > 0
            ? `Request type form is not publishable: ${refusedCustomFields.join(", ")} cannot be collected (not a customer-visible custom field of this work-item type, or the wrong control for its format)`
            : "Request type form is not publishable",
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
    await appendIntakeAudit(tx, {
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
    return {
      requestType: materializeRequestType(published),
      version: materializeRequestTypeVersion(version),
    };
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
    if (current.published === published) return materializeRequestType(current);
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
    await appendIntakeAudit(tx, {
      actorId,
      actorType: "person",
      workspaceId: row.workspaceId,
      action: published ? "request_type.published" : "request_type.unpublished",
      entityType: "request_type",
      entityId: row.id,
      before: { published: current.published, version: current.version },
      after: { published, version: row.version },
    });
    return materializeRequestType(row);
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
            and(
              inArray(
                schema.workspaceFeatureFlagTable.workspaceId,
                workspaceIds,
              ),
              eq(schema.workspaceFeatureFlagTable.featureKey, "feature.intake"),
            ),
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
  const storedOrders = workspaceIds.length
    ? await db
        .select()
        .from(schema.requestTypeGroupOrderTable)
        .where(
          inArray(schema.requestTypeGroupOrderTable.workspaceId, workspaceIds),
        )
    : [];
  const groupNames = orderPortalCatalogueGroups(
    [...enabledWorkspaceIds].map((workspaceId) => {
      const visible = ordered
        .filter((row) => row.workspaceId === workspaceId)
        .map((row) => row.type.group);
      const stored = storedOrders.find(
        (row) => row.workspaceId === workspaceId,
      );
      return {
        workspaceId,
        groups: [
          ...new Set([...(stored?.orderedGroups ?? []), ...visible]),
        ].filter((group) => visible.includes(group)),
      };
    }),
  );
  const groupOrder = new Map(groupNames.map((group, index) => [group, index]));
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
    )
    .map((row) => ({
      ...row,
      type: materializeRequestType(row.type),
      version: materializeRequestTypeVersion(row.version),
    }));
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
    await appendIntakeAudit(tx, {
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
  return {
    ...materializeSubmission(submission),
    ref: formatSubmissionReference(submission.number),
  };
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
  /**
   * #741: whether the triager's project reach includes the destination. Supplied by the staff
   * accept route; a project outside it is answered exactly like a missing or foreign one.
   */
  canReachProject: (project: {
    id: string;
    workspaceId: string;
    organisationId: string | null;
  }) => Promise<boolean> = async () => true,
  /** Runs after validation and before the accepted audit row (acceptance's claim audit). */
  beforeAcceptedAudit: () => Promise<void> = async () => {},
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
    throw intakeError(
      422,
      "destination_required",
      "A destination project must be selected before accepting this submission",
    );
  const [lockedWorkspace] = await tx
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .for("share")
    .limit(1);
  if (!lockedWorkspace)
    throw new HTTPException(409, {
      message: "Submission workspace is unavailable",
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
  if (
    !project ||
    project.organisationId !== submission.organisationId ||
    !(await canReachProject(project))
  )
    throw intakeError(
      422,
      "destination_unavailable",
      "Destination project is unavailable for this organisation",
    );
  const [version] = await tx
    .select()
    .from(schema.requestTypeVersionTable)
    .where(
      eq(schema.requestTypeVersionTable.id, submission.requestTypeVersionId),
    )
    .limit(1);
  if (!version)
    throw intakeError(
      409,
      "form_version_unavailable",
      "Submitted form version is unavailable",
    );
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
    throw intakeError(
      422,
      "work_item_type_unavailable",
      "The submitted work-item type is unavailable",
    );
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
  // P4R1-M2: with `feature.sla` off no SLA clock starts on the accepted work item.
  const policyId = !(await workspaceFeatureEnabled(
    "feature.sla",
    workspaceId,
    tx,
  ))
    ? null
    : (type.slaPolicyId ??
      requestSlaPolicyId ??
      resolveProjectSlaPolicyId({
        mode: project.slaPolicyMode as "inherit" | "override",
        overrideId: project.slaPolicyId,
        workspaceDefaultId: workspace.slaPolicyId,
      }));
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
  // #761 / RT-6: an ineligible snapshotted default assignee never fails acceptance; the item
  // is left unassigned and the reason is recorded in the acceptance audit row.
  let assigneeSkipped: { id: string; reason: string } | null = null;
  // AS-12: the request type's default overrides the project's; AS-11: with no request-type
  // default the project's default applies. The same eligibility rule below judges either.
  const effectiveDefaultAssigneeId =
    defaultAssigneeId ?? project.defaultAssigneeId ?? null;
  if (effectiveDefaultAssigneeId) {
    // PR-2: the roster is the project plus its ancestors, judged by the same rule as the
    // canonical create and the project-settings write (`resolveAssigneeEligibility`).
    const eligibility = await resolveAssigneeEligibility(
      tx,
      project.id,
      effectiveDefaultAssigneeId,
    );
    const [person] = eligibility.eligible
      ? await tx
          .select({ side: schema.personTable.side })
          .from(schema.personTable)
          .where(eq(schema.personTable.id, effectiveDefaultAssigneeId))
          .limit(1)
      : [];
    if (eligibility.eligible && person?.side === "staff")
      eligibleAssigneeId = effectiveDefaultAssigneeId;
    else
      assigneeSkipped = {
        id: effectiveDefaultAssigneeId,
        reason: eligibility.eligible
          ? "not_staff"
          : eligibility.reason === "not_active"
            ? "inactive"
            : "not_a_project_member",
      };
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
  // CF-11: customer answers mapped to customer-visible custom fields, re-checked now.
  const customFields = await applyAcceptedCustomFields(
    tx,
    {
      id: item.id,
      workspaceId,
      projectId: project.id,
      typeId: item.typeId,
    },
    mappedFields,
  );
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
  // P1-11 / AS-16, WI-29: a default-assigned conversion records the same assignment
  // activity, audit row, `work_item.assigned` event + assignee notification fan-out and
  // implicit watcher as the create path (actor excluded, AS-18), in this transaction. Covers
  // both the request-type default and the project-default fallback (AS-11/AS-12).
  if (eligibleAssigneeId)
    await recordInitialWorkItemFields(
      tx,
      item,
      { assigneeId: eligibleAssigneeId },
      actorId,
      actor.type,
    );
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
      claimedBy: submission.claimedBy,
      claimedAt: submission.claimedAt,
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
    throw intakeError(
      409,
      "submission_changed",
      "Submission changed before it could be accepted",
    );
  await beforeAcceptedAudit();
  await appendIntakeAudit(tx, {
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
      ...(customFields.skipped.length > 0
        ? { customFieldsSkipped: customFields.skipped }
        : {}),
      ...(assigneeSkipped
        ? {
            defaultAssigneeSkipped: {
              personId: assigneeSkipped.id,
              reason: assigneeSkipped.reason,
            },
          }
        : {}),
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
  canReachProject: (project: {
    id: string;
    workspaceId: string;
    organisationId: string | null;
  }) => Promise<boolean>,
) {
  const number = parseSubmissionReference(ref);
  if (number === null)
    throw new HTTPException(404, { message: "Submission not found" });
  // #743: the claim (IQ-16a) is taken inside the conversion transaction, so a failed accept
  // (missing or unreachable destination, stale configuration) rolls it back and leaves the
  // submission unclaimed for any triager.
  return db.transaction(async (tx) => {
    const { submission, appendAudit } = await claimSubmissionInTransaction(
      tx,
      number,
      ref,
      workspaceId,
      actorId,
      // `P2R1-12`: the loser of an accept race is shown the work item the first triager made,
      // when the destination is within the loser's reach.
      async (inner, converted) => {
        if (!converted.workItemId) return null;
        const [found] = await inner
          .select({
            id: schema.workItemTable.id,
            key: schema.workItemTable.key,
            project: schema.projectTable,
          })
          .from(schema.workItemTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.projectTable.id, schema.workItemTable.projectId),
          )
          .where(eq(schema.workItemTable.id, converted.workItemId))
          .limit(1);
        if (!found || !(await canReachProject(found.project))) return null;
        return { id: found.id, key: found.key };
      },
    );
    const [snapshot] = await tx
      .select()
      .from(schema.requestTypeVersionTable)
      .where(
        eq(schema.requestTypeVersionTable.id, submission.requestTypeVersionId),
      )
      .limit(1);
    if (!snapshot)
      throw intakeError(
        409,
        "form_version_unavailable",
        "Submitted form version is unavailable",
      );
    const item = await convertSubmissionInTransaction(
      tx,
      submission,
      workspaceId,
      { id: actorId, type: "person", name: "Staff" },
      projectId,
      typeId,
      snapshot.slaPolicyId,
      snapshot.defaultAssigneeId,
      canReachProject,
      appendAudit,
    );
    return { ref, state: "accepted" as const, workItem: item };
  });
}

export async function markSubmissionDuplicate(
  ref: string,
  workspaceId: string,
  actorId: string,
  workItemId: string,
  canReachProject: (project: {
    id: string;
    workspaceId: string;
    organisationId: string | null;
  }) => Promise<boolean>,
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
      throw intakeError(
        409,
        "submission_not_open",
        "Submission is no longer open",
      );
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
          // A merge target in a deleted project is gone for every other reader (`P2R1-P1`).
          isNull(schema.projectTable.deletedAt),
        ),
      )
      .limit(1);
    if (
      !target ||
      target.project.organisationId !== row.submission.organisationId ||
      !(await canReachProject(target.project))
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
      throw intakeError(
        409,
        "submission_changed",
        "Submission changed before it could be linked",
      );
    await appendIntakeAudit(tx, {
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
    return {
      ref,
      state: updated.state,
      workItem: materializeWorkItemDescription(target.item),
    };
  });
}

/** A signed-in portal customer, as far as read visibility (`CP-16`) is concerned. */
export type PortalViewer = { personId: string; organisationId: string };

export async function loadPortalViewer(
  personId: string,
): Promise<PortalViewer> {
  const [row] = await db
    .select({ organisationId: schema.personTable.organisationId })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.id, personId),
        eq(schema.personTable.side, "customer"),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
  if (!row)
    throw new HTTPException(404, { message: "Portal account not found" });
  return { personId, organisationId: row.organisationId };
}

/**
 * `CP-16` read visibility, always inside the viewer's own organisation: the requester, a
 * participant explicitly added to the submission (`request_participant`), or any customer of the
 * same organisation when the submission's `customer_visibility` is `organisation`. A `private`
 * submission is invisible to every other colleague, and another organisation's customer never
 * matches (the organisation equality is part of every branch). A miss is the constant 404.
 */
export function portalReadablePredicate(viewer: PortalViewer) {
  return and(
    eq(schema.submissionTable.organisationId, viewer.organisationId),
    or(
      eq(schema.submissionTable.requesterId, viewer.personId),
      eq(schema.submissionTable.customerVisibility, "organisation"),
      exists(
        db
          .select({ one: sql`1` })
          .from(schema.requestParticipantTable)
          .where(
            and(
              eq(
                schema.requestParticipantTable.submissionId,
                schema.submissionTable.id,
              ),
              eq(schema.requestParticipantTable.personId, viewer.personId),
            ),
          ),
      ),
    ),
  );
}

export async function findSubmission(
  ref: string,
  workspaceId?: string,
  requesterId?: string,
  /**
   * Staff detail only (#740): the caller's reach. Without a reachable work item the id and the
   * comments carried over from it are left out (`submission-linked-work-item.ts`). The portal
   * requester's own view passes nothing and keeps its existing behaviour.
   */
  staffIdentity?: ResolvedIdentity,
  /** Portal read path (`CP-16`): requester, participant or organisation colleague. */
  portalViewer?: PortalViewer,
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
        ...(portalViewer ? [portalReadablePredicate(portalViewer)] : []),
        ...(staffIdentity
          ? [
              currentWorkspaceReachPredicate(
                staffIdentity,
                schema.requestTypeTable.workspaceId,
                db,
              ),
            ]
          : []),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Submission not found" });
  const storedMessages = await db
    .select()
    .from(schema.submissionMessageTable)
    .where(
      and(
        eq(schema.submissionMessageTable.submissionId, row.submission.id),
        staffIdentity
          ? exists(
              db
                .select({ one: sql`1` })
                .from(schema.submissionTable)
                .innerJoin(
                  schema.requestTypeTable,
                  eq(
                    schema.requestTypeTable.id,
                    schema.submissionTable.requestTypeId,
                  ),
                )
                .where(
                  and(
                    eq(schema.submissionTable.id, row.submission.id),
                    currentWorkspaceReachPredicate(
                      staffIdentity,
                      schema.requestTypeTable.workspaceId,
                      db,
                    ),
                  ),
                ),
            )
          : undefined,
      ),
    )
    .orderBy(
      asc(schema.submissionMessageTable.createdAt),
      asc(schema.submissionMessageTable.id),
    );
  let messages = storedMessages.map((message) => ({
    ...message,
    createdAt: message.createdAt.toISOString(),
  }));
  let linkedWorkItemId = row.submission.workItemId;
  if (staffIdentity) {
    const [reachableWorkItem] = row.submission.workItemId
      ? await db
          .select({ id: schema.workItemTable.id })
          .from(schema.workItemTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.projectTable.id, schema.workItemTable.projectId),
          )
          .where(
            and(
              eq(schema.workItemTable.id, row.submission.workItemId),
              isNull(schema.projectTable.deletedAt),
              currentProjectReachPredicate(
                staffIdentity,
                schema.projectTable.id,
                schema.projectTable.workspaceId,
                schema.projectTable.organisationId,
                db,
              ),
            ),
          )
          .limit(1)
      : [];
    linkedWorkItemId = reachableWorkItem?.id ?? null;
    if (linkedWorkItemId === null) {
      row.submission = { ...row.submission, workItemId: null };
    }
  }
  if (row.submission.state === "accepted" && linkedWorkItemId) {
    const comments = await db
      .select({
        id: schema.commentTable.id,
        authorId: schema.commentTable.authorId,
        actorType: schema.commentTable.actorType,
        body: schema.commentTable.body,
        createdAt: schema.commentTable.createdAt,
      })
      .from(schema.commentTable)
      .innerJoin(
        schema.workItemTable,
        eq(schema.workItemTable.id, schema.commentTable.workItemId),
      )
      .innerJoin(
        schema.projectTable,
        eq(schema.projectTable.id, schema.workItemTable.projectId),
      )
      .where(
        and(
          eq(schema.commentTable.workItemId, linkedWorkItemId),
          eq(schema.commentTable.visibility, "public"),
          isNull(schema.commentTable.deletedAt),
          ...(staffIdentity ? [isNull(schema.projectTable.deletedAt)] : []),
          ...(staffIdentity
            ? [
                currentProjectReachPredicate(
                  staffIdentity,
                  schema.projectTable.id,
                  schema.projectTable.workspaceId,
                  schema.projectTable.organisationId,
                  db,
                ),
              ]
            : []),
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
        reasonCode: null,
        reasonParams: null,
        createdAt: comment.createdAt.toISOString(),
      }));
    messages = [...messages, ...transferred].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }
  return { ...materializeSubmissionBundle(row), ref, messages };
}

type PortalSubmissionSource = Omit<
  Awaited<ReturnType<typeof findSubmission>>,
  "submission" | "version"
> & {
  submission: typeof schema.submissionTable.$inferSelect;
  version: typeof schema.requestTypeVersionTable.$inferSelect;
};

/**
 * `CP-4`: how a message author appears to a customer. Staff who act publicly are named (the
 * author of a public comment or clarification); a customer is never named, only marked as the
 * viewer's own. Nothing else about the author (id, role, assignment) is exposed.
 */
export type PortalMessageAuthor = {
  actorType: "customer" | "triager" | "system";
  authorName: string | null;
  mine: boolean;
};

export async function portalMessageAuthors(
  messages: ReadonlyArray<{ authorId: string | null; actorType: string }>,
  viewerPersonId: string,
): Promise<
  (authorId: string | null, actorType: string) => PortalMessageAuthor
> {
  const ids = [
    ...new Set(
      messages.flatMap((message) =>
        message.authorId ? [message.authorId] : [],
      ),
    ),
  ];
  const people = ids.length
    ? await db
        .select({
          id: schema.personTable.id,
          side: schema.personTable.side,
          displayName: schema.personTable.displayName,
        })
        .from(schema.personTable)
        .where(inArray(schema.personTable.id, ids))
    : [];
  const byId = new Map(people.map((person) => [person.id, person]));
  return (authorId, actorType) => {
    // `P2R1-05`: a system message (the IQ-15 auto-decline) has no author to name.
    if (actorType === "system" || authorId === null)
      return { actorType: "system", authorName: null, mine: false };
    const person = byId.get(authorId);
    // A stored `triager` message or a comment by a non-customer person is staff; an author that
    // cannot be resolved falls back to the stored actor type, and anything but `customer` is staff.
    const staff = person
      ? person.side !== "customer"
      : actorType !== "customer";
    return staff
      ? {
          actorType: "triager",
          authorName: person?.displayName?.trim() || null,
          mine: false,
        }
      : {
          actorType: "customer",
          authorName: null,
          mine: authorId === viewerPersonId,
        };
  };
}

export async function findPortalSubmission(
  ref: string,
  viewerPersonId: string,
) {
  const viewer = await loadPortalViewer(viewerPersonId);
  const row = await findSubmission(
    ref,
    undefined,
    undefined,
    undefined,
    viewer,
  );
  const portalRow: PortalSubmissionSource = row;
  const isRequester = portalRow.submission.requesterId === viewer.personId;
  const formSchema = portalRow.version.formSchema as FormSchema;
  const fields = visibleFields(
    formSchema,
    portalRow.submission.formData as Record<string, FormValue>,
  ).map((field) => ({
    key: field.key,
    type: field.type,
    label: field.label,
    multiple: field.multiple,
  }));
  let customFields: PortalCustomField[] = [];
  let workItem: {
    title: string;
    description: string;
    priority: string | null;
    resolvedAt: string | null;
    sla: PortalSla | null;
  } | null = null;
  let statusFacts: PortalStatusWorkItem | null = null;
  let resolvedAt: Date | null = null;
  let linkedWorkItemId: string | null = null;
  if (portalRow.submission.workItemId) {
    // The submission itself was authorised for this viewer above; its linked work item belongs
    // to the submission's requester, so the lookup is keyed on that person (CP-16).
    const ownerId = portalRow.submission.requesterId;
    const [item] = await db
      .select({
        id: schema.workItemTable.id,
        workspaceId: schema.workItemTable.workspaceId,
        typeId: schema.workItemTable.typeId,
        title: schema.workItemTable.title,
        description: schema.workItemTable.description,
        stateGroup: schema.stateTemplateTable.group,
        priority: schema.workItemTable.priority,
        resolvedAt: schema.workItemTable.resolvedAt,
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
          eq(schema.workItemTable.id, portalRow.submission.workItemId),
          eq(schema.workItemTable.requesterId, ownerId),
          isNull(schema.workItemTable.deletedAt),
        ),
      )
      .limit(1);
    if (item) {
      const {
        id: itemId,
        workspaceId: itemWorkspaceId,
        typeId: itemTypeId,
        resolvedAt: itemResolvedAt,
        stateGroup,
        ...visible
      } = item;
      linkedWorkItemId = itemId;
      customFields = await loadPortalCustomFields(db, {
        id: itemId,
        workspaceId: itemWorkspaceId,
        typeId: itemTypeId,
      });
      resolvedAt = itemResolvedAt;
      statusFacts = { resolvedAt: itemResolvedAt, stateGroup };
      workItem = {
        ...visible,
        description: extractDocumentText(item.description),
        resolvedAt: itemResolvedAt ? itemResolvedAt.toISOString() : null,
        sla: await loadPortalSla(itemId, ownerId),
      };
    }
  }
  const windowDays = await findReopenWindowDays();
  const now = new Date();
  const withinWindow = resolvedAt
    ? isWithinReopenWindow(resolvedAt, now, windowDays)
    : false;
  const [rating] = linkedWorkItemId
    ? await db
        .select({
          score: schema.satisfactionRatingTable.score,
          comment: schema.satisfactionRatingTable.comment,
          updatedAt: schema.satisfactionRatingTable.updatedAt,
        })
        .from(schema.satisfactionRatingTable)
        .where(
          and(
            eq(schema.satisfactionRatingTable.workItemId, linkedWorkItemId),
            eq(
              schema.satisfactionRatingTable.personId,
              portalRow.submission.requesterId,
            ),
          ),
        )
        .limit(1)
    : [];
  const authorOf = await portalMessageAuthors(
    portalRow.messages,
    viewer.personId,
  );
  return {
    ref: portalRow.ref,
    submission: {
      state: portalRow.submission.state,
      formData: row.submission.formData,
      customerVisibility: portalRow.submission.customerVisibility,
      createdAt: portalRow.submission.createdAt.toISOString(),
    },
    customerStatus: portalCustomerStatus(
      portalRow.submission.state,
      statusFacts,
    ),
    isRequester,
    // CP-16: attachments are requester-only, so a colleague's view hides them.
    canViewAttachments: isRequester,
    canUpload: isRequester,
    canWithdraw:
      isRequester &&
      (portalRow.submission.state === "new" ||
        portalRow.submission.state === "clarifying") &&
      portalRow.submission.claimedBy === null,
    // CP-7: accepted, open, requester only, and a higher priority still exists.
    canEscalate:
      isRequester &&
      workItem !== null &&
      resolvedAt === null &&
      raisablePriorities(workItem.priority).length > 0,
    // CP-8 / IQ-15: an auto-declined submission, or a resolved request inside the window.
    canReopen:
      isRequester &&
      ((portalRow.submission.state === "declined" &&
        portalRow.submission.autoDeclinedAt !== null) ||
        (workItem !== null && resolvedAt !== null && withinWindow)),
    // CP-9: a resolved request can be rated; an existing rating can be changed in the window.
    canRate:
      isRequester &&
      workItem !== null &&
      resolvedAt !== null &&
      (rating === undefined || withinWindow),
    satisfaction: rating
      ? {
          rating: rating.score,
          comment: rating.comment,
          ratedAt: rating.updatedAt.toISOString(),
        }
      : null,
    requestType: {
      name: portalRow.requestType.name,
      description: portalRow.requestType.description,
      icon: portalRow.requestType.icon,
      group: portalRow.requestType.group,
    },
    version: { formSchema: { fields } },
    workItem,
    customFields,
    messages: portalRow.messages.map((message) => ({
      id: message.id,
      ...authorOf(message.authorId, message.actorType),
      body: message.body,
      reasonCode: message.reasonCode ?? null,
      reasonParams: message.reasonParams ?? null,
      createdAt: message.createdAt,
    })),
  };
}

/** CP-9: the requester's rating on a work item, for the staff submission detail. */
export async function findSubmissionSatisfaction(workItemId: string | null) {
  if (!workItemId) return null;
  const [row] = await db
    .select({
      score: schema.satisfactionRatingTable.score,
      comment: schema.satisfactionRatingTable.comment,
      updatedAt: schema.satisfactionRatingTable.updatedAt,
    })
    .from(schema.satisfactionRatingTable)
    .where(eq(schema.satisfactionRatingTable.workItemId, workItemId))
    .orderBy(asc(schema.satisfactionRatingTable.createdAt))
    .limit(1);
  return row
    ? {
        rating: row.score,
        comment: row.comment,
        ratedAt: row.updatedAt.toISOString(),
      }
    : null;
}

/**
 * Plain text of a stored rich-text body for the portal projection. A legacy plain-string body
 * (older transition notes and comments) is returned as it is; a document is flattened.
 */
export function extractDocumentText(value: unknown): string {
  if (typeof value === "string") return value;
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
  filters: SubmissionListFilters = {},
) {
  const visibleStates = states?.length ? states : ["new", "clarifying"];
  const scope = `staff:${workspaceId}:${[...visibleStates].sort().join(",")}:limit:${limit}:filters:${filtersScope(filters)}`;
  const decoded = decodeSubmissionCursor(cursor, scope);
  // The filter predicates are shared by the page and the total, so `meta.total` counts the
  // filtered queue. `olderThanDays` is evaluated once per request.
  const filterConditions = [
    eq(schema.requestTypeTable.workspaceId, workspaceId),
    inArray(schema.submissionTable.state, visibleStates),
    ...(filters.requestTypeKey
      ? [eq(schema.requestTypeTable.key, filters.requestTypeKey)]
      : []),
    ...(filters.assignee === UNCLAIMED
      ? [isNull(schema.submissionTable.claimedBy)]
      : filters.assignee === CLAIMED
        ? [isNotNull(schema.submissionTable.claimedBy)]
        : filters.assignee
          ? [eq(schema.submissionTable.claimedBy, filters.assignee)]
          : []),
    ...(filters.olderThanDays !== undefined
      ? [
          lt(
            schema.submissionTable.createdAt,
            olderThanCutoff(filters.olderThanDays, new Date()),
          ),
        ]
      : []),
  ];
  // `created_at` carries microseconds but the cursor round-trips through a JS Date
  // (milliseconds): comparing raw values re-serves the last row of the previous page. Both
  // the keyset predicate and the order use the millisecond-truncated value.
  const createdAtMs = sql`date_trunc('milliseconds', ${schema.submissionTable.createdAt})`;
  const conditions = [
    ...filterConditions,
    ...(decoded
      ? [
          or(
            sql`${createdAtMs} > ${new Date(decoded.createdAt)}`,
            and(
              sql`${createdAtMs} = ${new Date(decoded.createdAt)}`,
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
    .orderBy(asc(createdAtMs), asc(schema.submissionTable.id))
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
    .where(and(...filterConditions));
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
        ...materializeSubmissionBundle(row),
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
  // CP-16: the caller's own requests plus the organisation-visible and participant requests of
  // their organisation, never another organisation's and never a colleague's `private` request.
  const readable = portalReadablePredicate({
    personId: identity.personId,
    organisationId: identity.organisationId,
  });
  const scope = `portal:${identity.personId}:limit:${limit}`;
  const decoded = decodeSubmissionCursor(cursor, scope);
  const workspaceRows = await db
    .selectDistinct({ workspaceId: schema.requestTypeTable.workspaceId })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .where(readable);
  const workspaceIds = workspaceRows.map((row) => row.workspaceId);
  if (workspaceIds.length === 0)
    return {
      submissions: [],
      page: { nextCursor: null, hasMore: false },
      meta: { total: 0 },
    };
  const [[instance], workspaceFlags] = await Promise.all([
    db
      .select({
        enabled: schema.instanceFeatureFlagTable.enabled,
        locked: schema.instanceFeatureFlagTable.locked,
      })
      .from(schema.instanceFeatureFlagTable)
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.intake"))
      .limit(1),
    db
      .select({
        workspaceId: schema.workspaceFeatureFlagTable.workspaceId,
        enabled: schema.workspaceFeatureFlagTable.enabled,
      })
      .from(schema.workspaceFeatureFlagTable)
      .where(
        and(
          inArray(schema.workspaceFeatureFlagTable.workspaceId, workspaceIds),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.intake"),
        ),
      ),
  ]);
  const enabledWorkspaceIds = workspaceIds.filter(
    (workspaceId) =>
      resolveFeatureFlag({
        feature: "feature.intake",
        instance: instance ?? null,
        workspace:
          workspaceFlags.find((flag) => flag.workspaceId === workspaceId)
            ?.enabled ?? null,
      }).enabled,
  );
  if (enabledWorkspaceIds.length === 0)
    return {
      submissions: [],
      page: { nextCursor: null, hasMore: false },
      meta: { total: 0 },
    };
  // `created_at` has microseconds; the cursor round-trips through a JS Date (milliseconds).
  const ownCreatedAtMs = sql`date_trunc('milliseconds', ${schema.submissionTable.createdAt})`;
  const conditions = [
    readable,
    inArray(schema.requestTypeTable.workspaceId, enabledWorkspaceIds),
    ...(decoded
      ? [
          or(
            sql`${ownCreatedAtMs} < ${new Date(decoded.createdAt)}`,
            and(
              sql`${ownCreatedAtMs} = ${new Date(decoded.createdAt)}`,
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
    .orderBy(desc(ownCreatedAtMs), desc(schema.submissionTable.id))
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
        readable,
        inArray(schema.requestTypeTable.workspaceId, enabledWorkspaceIds),
      ),
    );
  // CP-6: the customer-safe `{state, dueAt}` on each row that has a linked work item, in small
  // concurrent batches (one evaluation per such row, at most `limit` rows).
  const slas = new Map<string, PortalSla | null>();
  const withItem = pageRows.filter((row) => row.submission.workItemId);
  for (let index = 0; index < withItem.length; index += 10) {
    await Promise.all(
      withItem.slice(index, index + 10).map(async (row) => {
        slas.set(
          row.submission.id,
          await loadPortalSla(
            row.submission.workItemId as string,
            row.submission.requesterId,
          ),
        );
      }),
    );
  }
  const statusFacts = new Map<string, PortalStatusWorkItem>();
  const itemIds = withItem.map((row) => row.submission.workItemId as string);
  if (itemIds.length > 0) {
    const facts = await db
      .select({
        id: schema.workItemTable.id,
        resolvedAt: schema.workItemTable.resolvedAt,
        stateGroup: schema.stateTemplateTable.group,
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
      .where(inArray(schema.workItemTable.id, itemIds));
    for (const fact of facts)
      statusFacts.set(fact.id, {
        resolvedAt: fact.resolvedAt,
        stateGroup: fact.stateGroup,
      });
  }
  return {
    submissions: pageRows.map((row) => ({
      ...row,
      submission: materializeSubmission(row.submission),
      requestType: materializeRequestType(row.requestType),
      ref: formatSubmissionReference(row.submission.number),
      isRequester: row.submission.requesterId === identity.personId,
      customerStatus: portalCustomerStatus(
        row.submission.state,
        row.submission.workItemId
          ? (statusFacts.get(row.submission.workItemId) ?? null)
          : null,
      ) satisfies PortalCustomerStatus,
      sla: slas.get(row.submission.id) ?? null,
    })),
    page: { nextCursor, hasMore },
    meta: { total: totalRow?.value ?? 0 },
  };
}

export async function suggestDuplicateWorkItems(
  ref: string,
  workspaceId: string,
  reachableProjectIds: readonly string[],
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
  const grouped = await suggestDuplicatesForQueueRows(
    workspaceId,
    [
      {
        ref,
        summary: title,
        organisationId: row.submission.organisationId,
      },
    ],
    reachableProjectIds,
  );
  return grouped.get(ref) ?? [];
}

/**
 * Claims the submission inside the caller's transaction. #743: acceptance runs this in the
 * same transaction as conversion, so a failed accept rolls the claim (and its audit row)
 * back instead of leaving the submission claimed. The claim audit row is returned as a thunk
 * so acceptance can append it after its own validation: audit appends take the audit-chain
 * advisory lock, which must not be held while waiting on the destination project lock.
 */
async function claimSubmissionInTransaction(
  tx: DbTransaction,
  number: number,
  ref: string,
  workspaceId: string,
  actorId: string,
  resolveWinner?: (
    tx: DbTransaction,
    submission: typeof schema.submissionTable.$inferSelect,
  ) => Promise<{ id: string; key: string } | null>,
) {
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
  if (row.submission.state !== "new" && row.submission.state !== "clarifying") {
    const winner =
      row.submission.state === "accepted" && resolveWinner
        ? await resolveWinner(tx, row.submission)
        : null;
    if (winner)
      throw intakeError(
        409,
        "submission_already_converted",
        "Submission is no longer open",
        { workItem: winner },
      );
    throw intakeError(
      409,
      "submission_not_open",
      "Submission is no longer open",
    );
  }
  // `IQ-16a`: the claim is the customer's withdrawal lock, not an assignment. Any triager on the
  // triage team may act on a claimed submission, so a claim by someone else is kept as it is.
  if (row.submission.claimedBy && row.submission.claimedAt)
    return { submission: row.submission, appendAudit: async () => {} };
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
    throw intakeError(
      409,
      "submission_changed",
      "Submission changed; reload before acting",
    );
  return {
    submission: updated,
    appendAudit: async () => {
      await appendIntakeAudit(tx, {
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
    },
  };
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
    const { submission, appendAudit } = await claimSubmissionInTransaction(
      tx,
      number,
      ref,
      workspaceId,
      actorId,
    );
    await appendAudit();
    return {
      id: submission.id,
      ref,
      state: submission.state,
      claimedBy: submission.claimedBy,
      claimedAt: submission.claimedAt,
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
  const posted = await postSubmissionMessageInTransaction(input, number);
  const { reopenWorkItemId, ...result } = posted as typeof posted & {
    reopenWorkItemId?: string;
  };
  if (reopenWorkItemId) {
    // WF-21: the reopen request is already durable (a non-warning `reopen_received` row written
    // in the reply transaction; `reopen_requested` is the post-commit refusal flag only), so a failure here never fails the committed reply; it is
    // logged, never swallowed.
    try {
      await requestCustomerReopen({
        workItemId: reopenWorkItemId,
        source: "reply",
      });
    } catch {
      logTaskDesk({
        module: "jobs",
        message: "jobs.failure",
        level: "error",
        result: "degraded",
      });
    }
  }
  return result;
}

async function postSubmissionMessageInTransaction(
  input: {
    ref: string;
    workspaceId?: string;
    requesterId?: string;
    actorId: string;
    actorType: "customer" | "triager";
    body: string;
  },
  number: number,
) {
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
          message: "This request is temporarily unavailable",
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
      await appendIntakeAudit(tx, {
        actorId: input.actorId,
        actorType: "person",
        workspaceId: row.workspaceId,
        organisationId: row.submission.organisationId,
        action: "submission.replied",
        entityType: "submission",
        entityId: row.submission.id,
        after: { number, by: "customer", workItemId: row.workItem.id },
      });
      await enqueueNotificationEvent(
        tx,
        {
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
        },
        { resolveRecipients: resolveSubmissionRepliedRecipients },
      );
      if (row.workItem.resolvedAt) {
        await recordReopenRequested(tx, {
          workspaceId: row.workspaceId,
          workItemId: row.workItem.id,
          source: "reply",
        });
      }
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
        // WF-21: a reply to a closed request reopens it; done after this commit.
        reopenWorkItemId: row.workItem.id,
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
        // IQ-15: the stored period start; `updated_at` only for rows that pre-date the column.
        clarifyingSince:
          before.state === "clarifying"
            ? (before.clarifyingSince ?? before.updatedAt)
            : null,
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
        // IQ-15 / IQ-13: a staff clarification (re)starts the window, the customer's reply
        // ends it.
        clarifyingSince: transitioned.record.clarifyingSince,
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
    await appendIntakeAudit(tx, {
      actorId: input.actorId,
      actorType: "person",
      workspaceId: row.workspaceId,
      organisationId: before.organisationId,
      action: "submission.replied",
      entityType: "submission",
      entityId: before.id,
      after: { number, by: input.actorType },
    });
    // IQ-12 / EV-1: the customer (staff message) or last handler (customer reply) is notified in
    // this same transaction; the row is keyed `(event_id, person_id)`, so a replay is a no-op.
    await enqueueNotificationEvent(
      tx,
      {
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
      },
      { resolveRecipients: resolveSubmissionRepliedRecipients },
    );
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
    await appendIntakeAudit(tx, {
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
      throw intakeError(
        409,
        "submission_not_open",
        "Submission is no longer open",
      );
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
    await appendIntakeAudit(tx, {
      actorId,
      actorType: "person",
      workspaceId,
      organisationId: before.organisationId,
      action: "submission.declined",
      entityType: "submission",
      entityId: before.id,
      after: { number, reason },
    });
    // NO-21: the requester is told, with the reason verbatim (same path as IQ-15's auto-decline).
    await enqueueNotificationEvent(
      tx,
      {
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
      },
      { resolveRecipients: resolveSubmissionRepliedRecipients },
    );
    return { ref, state: updated.state, reason, message };
  });
}
