import { createId } from "@paralleldrive/cuid2";
import {
  type CustomFieldDefinition,
  type CustomFieldFormat,
  type FormSchema,
  type FormValue,
  isValidCustomFieldValue,
  normalizeCustomFieldValue,
  resolveCustomFieldValues,
  validateSubmissionData,
  visibleFields,
} from "@taskdesk/domain/intake";
import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import type { DbTransaction } from "../events/outbox";
import { requireFeatureEnabled } from "../feature-flags/runtime";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { resolveAssigneeEligibility } from "../work-item/assignee-eligibility";
import createWorkItem from "../work-item/controllers/create-work-item";
import {
  getSubmissionEventScope,
  notifySubmissionEvent,
  recordSubmissionEvent,
} from "./events";
import { submissionListItemSchema, submissionReceiptSchema } from "./response";
import {
  acceptSubmissionBody,
  declineSubmissionBody,
  duplicateSubmissionBody,
  submissionListQuery,
  submissionMessageBody,
  submissionRefParam,
} from "./schema";

const itemSchema = submissionListItemSchema.extend({
  requestTypeName: z.string(),
});
const listSchema = z.object({
  items: z.array(itemSchema),
  nextBefore: z.string().nullable(),
});
const detailSchema = itemSchema.extend({
  messages: z.array(
    z.object({
      id: z.string(),
      actorType: z.enum(["customer", "triager"]),
      body: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
  formSchema: z.object({ fields: z.array(z.unknown()) }),
  suggestedProjectId: z.string().nullable(),
  suggestedWorkItemTypeId: z.string().nullable(),
});

function submissionValidationSchema(formSchema: FormSchema): FormSchema {
  // Requiredness for file fields is established by attachment rows below, not by a
  // second copy of attachment IDs in JSONB form data.
  return {
    ...formSchema,
    fields: formSchema.fields.map((field) =>
      field.type === "file" ? { ...field, required: false } : field,
    ),
  };
}

export function validateSubmissionAnswers(
  formSchema: FormSchema,
  formData: Record<string, FormValue>,
) {
  return validateSubmissionData(
    submissionValidationSchema(formSchema),
    formData,
  );
}

export async function assertSubmissionFileAnswers(
  tx: DbTransaction,
  submissionId: string,
  formSchema: FormSchema,
  formData: Record<string, FormValue>,
): Promise<void> {
  const visibleFileFields = visibleFields(formSchema, formData).filter(
    (field) => field.type === "file",
  );
  const visibleByKey = new Map(
    visibleFileFields.map((field) => [field.key, field]),
  );
  const attachments = await tx
    .select({
      id: schema.attachmentTable.id,
      fieldKey: schema.attachmentTable.submissionFieldKey,
      state: schema.attachmentTable.state,
      customerVisible: schema.attachmentTable.customerVisible,
      deletedAt: schema.attachmentTable.deletedAt,
    })
    .from(schema.attachmentTable)
    .where(eq(schema.attachmentTable.submissionId, submissionId));
  if (
    attachments.some(
      (attachment) =>
        !attachment.fieldKey ||
        !visibleByKey.has(attachment.fieldKey) ||
        attachment.state !== "ready" ||
        attachment.customerVisible !== true ||
        attachment.deletedAt !== null,
    )
  ) {
    throw new HTTPException(400, {
      message: "File answers must be completed uploads for visible form fields",
    });
  }

  for (const field of visibleFileFields) {
    const rows = attachments.filter((item) => item.fieldKey === field.key);
    if (field.required === true && rows.length === 0) {
      throw new HTTPException(400, {
        message: "A required file answer is missing",
      });
    }
    if (!field.multiple && rows.length > 1) {
      throw new HTTPException(400, {
        message: "A file field has too many uploads",
      });
    }
    const posted = Object.hasOwn(formData, field.key)
      ? formData[field.key]
      : undefined;
    if (posted === undefined) continue;
    const ids = Array.isArray(posted) ? posted : [posted];
    if (
      (field.multiple === true && !Array.isArray(posted)) ||
      (field.multiple !== true && Array.isArray(posted)) ||
      ids.some(
        (id) =>
          typeof id !== "string" ||
          !rows.some((attachment) => attachment.id === id),
      )
    ) {
      throw new HTTPException(400, {
        message:
          "File answers must reference their completed form-field uploads",
      });
    }
  }
}
const duplicateList = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      state: z.string(),
      similarity: z.number(),
    }),
  ),
});
export type IntakeQueueDto = z.infer<typeof listSchema>;
export type IntakeSubmissionDto = z.infer<typeof detailSchema>;

async function submissionReach(c: Context, next: Next) {
  const ref = c.req.param("ref");
  const number = Number(ref?.replace(/^SUB-/, ""));
  if (!Number.isSafeInteger(number) || number < 1)
    throw new HTTPException(404, { message: "Submission not found" });
  const [row] = await db
    .select({
      workspaceId: schema.requestTypeTable.workspaceId,
      state: schema.submissionTable.state,
    })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .where(eq(schema.submissionTable.number, number))
    .limit(1);
  if (!row || row.state === "draft")
    throw new HTTPException(404, { message: "Submission not found" });
  await validateWorkspaceAccess(
    c.get("userId") as string,
    row.workspaceId,
    (c.get("apiKey") as { id: string } | undefined)?.id,
  );
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

async function staffPerson(c: Context) {
  const userId = c.get("userId") as string | undefined;
  const [person] = userId
    ? await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(
          and(
            eq(schema.personTable.userId, userId),
            eq(schema.personTable.side, "staff"),
            eq(schema.personTable.active, true),
          ),
        )
        .limit(1)
    : [];
  if (!person) throw new HTTPException(403, { message: "Forbidden" });
  return person;
}

function answerText(value: FormValue): string {
  if (typeof value === "string") return value;
  if (value === null) return "";
  return JSON.stringify(value);
}

function intakeDescription(
  fields: readonly { label: string; value: FormValue }[],
): unknown {
  if (fields.length === 0) return null;
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Request details" }],
      },
      ...fields.map(({ label, value }) => ({
        type: "paragraph",
        content: [{ type: "text", text: `${label}: ${answerText(value)}` }],
      })),
    ],
  };
}

function translatedAnswer(
  field: FormSchema["fields"][number],
  data: Readonly<Record<string, FormValue>>,
): FormValue | undefined {
  if (!Object.hasOwn(data, field.key)) return undefined;
  const value = data[field.key];
  const map = field.mapsTo?.map;
  if (map && value !== null && value !== undefined) {
    if (Array.isArray(value)) {
      return value.map((entry) => {
        if (typeof entry !== "string" || !Object.hasOwn(map, entry)) {
          throw new HTTPException(400, {
            message: "Submission mapping is invalid",
          });
        }
        return map[entry] as FormValue;
      });
    }
    if (typeof value !== "string" || !Object.hasOwn(map, value)) {
      throw new HTTPException(400, {
        message: "Submission mapping is invalid",
      });
    }
    return map[value] as FormValue;
  }
  return value;
}

export async function acceptSubmissionWorkItem(
  input: {
    number: number;
    workspaceId: string;
    actorId: string;
    projectId: string;
    typeId: string;
  },
  options: {
    transaction?: DbTransaction;
    afterCommit?: Array<() => Promise<void>>;
  } = {},
) {
  const afterCommit = options.afterCommit ?? [];
  const execute = async (tx: DbTransaction) => {
    const [submission] = await tx
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.number, input.number))
      .for("update")
      .limit(1);
    if (!submission)
      throw new HTTPException(404, { message: "Submission not found" });
    if (submission.state !== "new" && submission.state !== "clarifying") {
      throw new HTTPException(409, {
        message: "Submission has already been handled",
      });
    }

    const [requestType] = await tx
      .select({
        forcePrivate: schema.requestTypeTable.forcePrivate,
        workspaceId: schema.requestTypeTable.workspaceId,
      })
      .from(schema.requestTypeTable)
      .where(
        and(
          eq(schema.requestTypeTable.id, submission.requestTypeId),
          eq(schema.requestTypeTable.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    const [version] = await tx
      .select()
      .from(schema.requestTypeVersionTable)
      .where(
        and(
          eq(
            schema.requestTypeVersionTable.id,
            submission.requestTypeVersionId,
          ),
          eq(
            schema.requestTypeVersionTable.requestTypeId,
            submission.requestTypeId,
          ),
          eq(schema.requestTypeVersionTable.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!requestType || !version)
      throw new HTTPException(409, {
        message: "Published mapping is unavailable",
      });

    const [project] = await tx
      .select()
      .from(schema.projectTable)
      .where(
        and(
          eq(schema.projectTable.id, input.projectId),
          eq(schema.projectTable.workspaceId, requestType.workspaceId),
          eq(schema.projectTable.organisationId, submission.organisationId),
          isNull(schema.projectTable.deletedAt),
          isNull(schema.projectTable.archivedAt),
        ),
      )
      .limit(1);
    if (!project)
      throw new HTTPException(400, {
        message: "Project is unavailable for this submission",
      });
    const [workItemType] = await tx
      .select({ id: schema.workItemTypeTable.id })
      .from(schema.workItemTypeTable)
      .where(
        and(
          eq(schema.workItemTypeTable.id, input.typeId),
          eq(schema.workItemTypeTable.workspaceId, requestType.workspaceId),
        ),
      )
      .limit(1);
    if (!workItemType)
      throw new HTTPException(400, {
        message: "Work item type is unavailable",
      });

    const formSchema = version.formSchema as FormSchema;
    const formData = submission.formData as Record<string, FormValue>;
    if (validateSubmissionAnswers(formSchema, formData).length) {
      throw new HTTPException(400, {
        message: "Submission mapping is invalid",
      });
    }
    await assertSubmissionFileAnswers(tx, submission.id, formSchema, formData);
    const visibleFormFields = visibleFields(formSchema, formData);
    const titleField = formSchema.fields.filter(
      (field) => field.mapsTo?.field === "title",
    );
    if (titleField.length !== 1)
      throw new HTTPException(400, {
        message: "Submission title mapping is invalid",
      });
    const rawTitle = translatedAnswer(titleField[0]!, formData);
    if (
      typeof rawTitle !== "string" ||
      rawTitle.trim().length === 0 ||
      rawTitle.length > 500
    ) {
      throw new HTTPException(400, {
        message: "Submission title mapping is invalid",
      });
    }

    let priority: "low" | "medium" | "high" | "urgent" | undefined;
    let dueDate: Date | undefined;
    const customInput: Record<string, unknown> = {};
    const customTargets = new Set<string>();
    for (const field of visibleFormFields) {
      const target = field.mapsTo?.field;
      if (!target || target === "title") continue;
      const value = translatedAnswer(field, formData);
      if (target.startsWith("cf.")) {
        const key = target.slice(3);
        if (!key || customTargets.has(key))
          throw new HTTPException(400, {
            message: "Submission custom-field mapping is invalid",
          });
        customTargets.add(key);
        if (value !== undefined) customInput[key] = value;
      } else if (target === "priority") {
        if (value !== undefined && value !== null) {
          if (
            value !== "low" &&
            value !== "medium" &&
            value !== "high" &&
            value !== "urgent"
          )
            throw new HTTPException(400, {
              message: "Submission priority mapping is invalid",
            });
          priority = value;
        }
      } else if (target === "due_date") {
        if (value !== undefined && value !== null && value !== "") {
          if (
            typeof value !== "string" ||
            !isValidCustomFieldValue("date", value, null)
          )
            throw new HTTPException(400, {
              message: "Submission date mapping is invalid",
            });
          dueDate = new Date(`${value}T00:00:00.000Z`);
        }
      } else if (target !== "description") {
        throw new HTTPException(400, {
          message: "Submission mapping is invalid",
        });
      }
    }

    const fieldRows = await tx
      .select({
        id: schema.customFieldTable.id,
        key: schema.customFieldTable.key,
        format: schema.customFieldTable.format,
        options: schema.customFieldTable.options,
        defaultValue: schema.customFieldTable.defaultValue,
        condition: schema.customFieldTable.visibilityCondition,
        customerVisible: schema.customFieldTable.customerVisible,
        visible: schema.customFieldTypeVisibilityTable.visible,
        required: schema.customFieldTypeVisibilityTable.required,
      })
      .from(schema.customFieldTable)
      .innerJoin(
        schema.customFieldTypeVisibilityTable,
        eq(
          schema.customFieldTypeVisibilityTable.customFieldId,
          schema.customFieldTable.id,
        ),
      )
      .where(
        and(
          eq(schema.customFieldTable.workspaceId, requestType.workspaceId),
          eq(schema.customFieldTable.entityType, "work_item"),
          isNull(schema.customFieldTable.deletedAt),
          eq(
            schema.customFieldTypeVisibilityTable.workItemTypeId,
            input.typeId,
          ),
          eq(schema.customFieldTypeVisibilityTable.visible, true),
        ),
      );
    const fieldsByKey = new Map(fieldRows.map((field) => [field.key, field]));
    for (const key of customTargets) {
      const field = fieldsByKey.get(key);
      if (!field || !field.customerVisible)
        throw new HTTPException(409, {
          message: "Published custom-field mapping is unavailable",
        });
    }
    const definitions: CustomFieldDefinition[] = fieldRows.map((field) => ({
      key: field.key,
      format: field.format as CustomFieldFormat,
      options: field.options,
      defaultValue: field.defaultValue,
      condition: field.condition as CustomFieldDefinition["condition"],
      visible: field.visible,
      required: field.required,
    }));
    const personRows = await tx
      .select({ id: schema.personTable.id })
      .from(schema.membershipTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.membershipTable.personId),
      )
      .where(
        and(
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
          eq(schema.personTable.active, true),
        ),
      );
    const resolved = resolveCustomFieldValues(definitions, customInput, {
      personIds: new Set(personRows.map((person) => person.id)),
      emailIsValid: (value) => z.string().email().safeParse(value).success,
    });
    if (!resolved.ok)
      throw new HTTPException(400, {
        message: "Custom-field values are invalid",
      });

    const mappedDescription = visibleFormFields
      .filter(
        (field) =>
          field.mapsTo?.field === "description" &&
          Object.hasOwn(formData, field.key),
      )
      .map((field) => ({ label: field.label, value: formData[field.key]! }));
    const unmapped = visibleFormFields
      .filter((field) => !field.mapsTo && Object.hasOwn(formData, field.key))
      .map((field) => ({ label: field.label, value: formData[field.key]! }));
    const description = intakeDescription([...mappedDescription, ...unmapped]);
    const assigneeId = version.defaultAssigneeId;
    if (assigneeId) {
      const eligibility = await resolveAssigneeEligibility(
        tx,
        project.id,
        assigneeId,
      );
      if (!eligibility.eligible)
        throw new HTTPException(400, {
          message: "Default assignee is unavailable for the selected project",
        });
    }

    const workItem = await createWorkItem(
      {
        projectId: project.id,
        workspaceId: requestType.workspaceId,
        typeId: input.typeId,
        title: rawTitle,
        description,
        priority,
        dueDate,
        actorId: input.actorId,
        actorType: "person",
        actorSource: "portal",
        requesterId: submission.requesterId,
        assigneeId,
        requestTypeSlaPolicyId: version.slaPolicyId,
        slaStartedAt: submission.submittedAt ?? submission.createdAt,
        customerVisibility: requestType.forcePrivate
          ? "private"
          : (submission.customerVisibility as "private" | "organisation"),
      },
      { transaction: tx, afterCommit },
    );

    const valueRows = Object.entries(resolved.values).map(([key, value]) => {
      const field = fieldsByKey.get(key);
      if (!field)
        throw new HTTPException(400, {
          message: "Custom-field values are invalid",
        });
      return {
        customFieldId: field.id,
        entityType: "work_item",
        entityId: workItem.id,
        value: normalizeCustomFieldValue(
          field.format as CustomFieldFormat,
          value,
        ),
        projectId: project.id,
        organisationId: project.organisationId,
      };
    });
    if (valueRows.length) {
      await tx.insert(schema.customFieldValueTable).values(valueRows);
    }

    const messages = await tx
      .select()
      .from(schema.submissionMessageTable)
      .where(eq(schema.submissionMessageTable.submissionId, submission.id))
      .orderBy(
        asc(schema.submissionMessageTable.createdAt),
        asc(schema.submissionMessageTable.id),
      );
    if (messages.length) {
      await tx.insert(schema.commentTable).values(
        messages.map((message) => ({
          workspaceId: requestType.workspaceId,
          workItemId: workItem.id,
          authorId: message.authorId,
          actorType: "person",
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: message.body }],
              },
            ],
          },
          visibility: "public",
          createdAt: message.createdAt,
        })),
      );
      const firstStaffResponse = messages.find(
        (message) => message.actorType === "triager",
      );
      if (firstStaffResponse) {
        await tx
          .update(schema.workItemTable)
          .set({ firstResponseAt: firstStaffResponse.createdAt })
          .where(eq(schema.workItemTable.id, workItem.id));
      }
      await tx
        .delete(schema.submissionMessageTable)
        .where(eq(schema.submissionMessageTable.submissionId, submission.id));
    }
    await tx
      .update(schema.attachmentTable)
      .set({ workItemId: workItem.id, submissionId: null })
      .where(
        and(
          eq(schema.attachmentTable.submissionId, submission.id),
          eq(schema.attachmentTable.state, "ready"),
          isNull(schema.attachmentTable.workItemId),
          isNull(schema.attachmentTable.commentId),
        ),
      );
    const [updated] = await tx
      .update(schema.submissionTable)
      .set({
        state: "accepted",
        workItemId: workItem.id,
        claimedBy: submission.claimedBy ?? input.actorId,
        claimedAt: submission.claimedAt ?? new Date(),
        version: submission.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.submissionTable.id, submission.id))
      .returning({
        number: schema.submissionTable.number,
        createdAt: schema.submissionTable.createdAt,
      });
    if (!updated)
      throw new HTTPException(503, { message: "Submission unavailable" });
    const scope = await getSubmissionEventScope(tx, submission.id);
    if (!scope)
      throw new HTTPException(404, { message: "Submission not found" });
    await recordSubmissionEvent(tx, {
      kind: "submission.accepted",
      ...scope,
      actorId: input.actorId,
      actorType: "person",
      payload: {
        ref: `SUB-${updated.number}`,
        workItemKey: workItem.key,
      },
    });
    return {
      number: updated.number,
      createdAt: updated.createdAt,
      workItemKey: workItem.key,
    };
  };
  const result = options.transaction
    ? await execute(options.transaction)
    : await db.transaction(execute);
  if (!options.transaction) {
    for (const after of afterCommit) await after();
    await notifySubmissionEvent("submission.accepted", {
      ref: `SUB-${result.number}`,
      workItemKey: result.workItemKey,
    });
  }
  return result;
}

const queueRoute = createRoute({
  method: "get",
  path: "/submissions",
  operationId: "listSubmissions",
  tags: ["Intake"],
  summary: "List submissions in a reachable workspace",
  middleware: [
    workspaceAccess.fromQuery(),
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId") as string,
    })),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: { query: submissionListQuery },
  responses: {
    200: jsonResponse("Submission queue page", listSchema),
    403: errorResponse("Forbidden"),
    404: errorResponse("Workspace or feature not found"),
  },
});
const detailRoute = createRoute({
  method: "get",
  path: "/submissions/{ref}",
  operationId: "getSubmission",
  tags: ["Intake"],
  summary: "Read a submission and its thread",
  middleware: [
    submissionReach,
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId") as string,
    })),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse("Submission detail", detailSchema),
    403: errorResponse("Forbidden"),
    404: errorResponse("Submission not found"),
  },
});
const claimRoute = createRoute({
  method: "post",
  path: "/submissions/{ref}/claim",
  operationId: "claimSubmission",
  tags: ["Intake"],
  summary: "Claim a submission for triage",
  middleware: [
    submissionReach,
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId") as string,
    })),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse("Claimed submission", submissionReceiptSchema),
    404: errorResponse("Submission not found"),
    409: errorResponse("Submission has already been claimed or resolved"),
  },
});
const acceptRoute = createRoute({
  method: "post",
  path: "/submissions/{ref}/accept",
  operationId: "acceptSubmission",
  tags: ["Intake"],
  summary: "Convert a submission into a work item",
  middleware: [
    submissionReach,
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId") as string,
    })),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: acceptSubmissionBody } },
    },
  },
  responses: {
    200: jsonResponse("Accepted submission", submissionReceiptSchema),
    400: errorResponse("Submission mapping or custom field values are invalid"),
    404: errorResponse("Submission not found"),
    409: errorResponse(
      "Submission has already been handled or its mapping is unavailable",
    ),
  },
});
const declineRoute = createRoute({
  method: "post",
  path: "/submissions/{ref}/decline",
  operationId: "declineSubmission",
  tags: ["Intake"],
  summary: "Decline a submission with a customer-visible reason",
  middleware: [
    submissionReach,
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId") as string,
    })),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: declineSubmissionBody } },
    },
  },
  responses: {
    200: jsonResponse("Declined submission", submissionReceiptSchema),
    400: errorResponse("A reason is required"),
    404: errorResponse("Submission not found"),
    409: errorResponse("Submission has already been handled"),
  },
});
const messageRoute = createRoute({
  method: "post",
  path: "/submissions/{ref}/messages",
  operationId: "messageSubmission",
  tags: ["Intake"],
  summary: "Ask a customer for clarification",
  middleware: [
    submissionReach,
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId") as string,
    })),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: submissionMessageBody } },
    },
  },
  responses: {
    200: jsonResponse("Clarification message", submissionReceiptSchema),
    404: errorResponse("Submission not found"),
    409: errorResponse("Submission cannot be clarified"),
  },
});
const duplicateRoute = createRoute({
  method: "post",
  path: "/submissions/{ref}/duplicate",
  operationId: "markSubmissionDuplicate",
  tags: ["Intake"],
  summary: "Link a submission to an existing work item",
  middleware: [
    submissionReach,
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId") as string,
    })),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: duplicateSubmissionBody } },
    },
  },
  responses: {
    200: jsonResponse("Duplicate submission", submissionReceiptSchema),
    404: errorResponse("Submission or work item not found"),
    409: errorResponse("Submission has already been handled"),
  },
});
const duplicatesRoute = createRoute({
  method: "get",
  path: "/submissions/{ref}/duplicates",
  operationId: "suggestSubmissionDuplicates",
  tags: ["Intake"],
  summary: "Suggest recent similar work items",
  middleware: [
    submissionReach,
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId") as string,
    })),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse("Duplicate suggestions", duplicateList),
    404: errorResponse("Submission not found"),
  },
});

const routes = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(queueRoute, async (c) => {
    const query = c.req.valid("query");
    const clauses = [
      eq(schema.requestTypeTable.workspaceId, query.workspaceId),
      ne(schema.submissionTable.state, "draft"),
    ];
    if (query.state)
      clauses.push(eq(schema.submissionTable.state, query.state));
    if (query.before)
      clauses.push(
        lt(schema.submissionTable.number, Number(query.before.slice(4))),
      );
    const rows = await db
      .select({
        id: schema.submissionTable.id,
        number: schema.submissionTable.number,
        state: schema.submissionTable.state,
        workItemId: schema.submissionTable.workItemId,
        createdAt: schema.submissionTable.createdAt,
        organisationId: schema.submissionTable.organisationId,
        requesterId: schema.submissionTable.requesterId,
        requestTypeId: schema.submissionTable.requestTypeId,
        requestTypeVersionId: schema.submissionTable.requestTypeVersionId,
        formData: schema.submissionTable.formData,
        claimedBy: schema.submissionTable.claimedBy,
        claimedAt: schema.submissionTable.claimedAt,
        version: schema.submissionTable.version,
        requestTypeName: schema.requestTypeTable.name,
        workItemKey: schema.workItemTable.key,
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
      .where(and(...clauses))
      .orderBy(desc(schema.submissionTable.number))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const items = page.map((row) =>
      itemSchema.parse({
        id: row.id,
        ref: `SUB-${row.number}`,
        state: row.state,
        workItemKey: row.workItemKey,
        createdAt: row.createdAt,
        organisationId: row.organisationId,
        requesterId: row.requesterId,
        requestTypeId: row.requestTypeId,
        requestTypeVersionId: row.requestTypeVersionId,
        formData: row.formData,
        claimedBy: row.claimedBy,
        claimedAt: row.claimedAt,
        version: row.version,
        requestTypeName: row.requestTypeName,
      }),
    );
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      {
        items,
        nextBefore:
          rows.length > query.limit ? `SUB-${page.at(-1)?.number}` : null,
      },
      200,
    );
  })
  .openapi(detailRoute, async (c) => {
    const number = Number(c.req.valid("param").ref.slice(4));
    const [row] = await db
      .select({
        id: schema.submissionTable.id,
        number: schema.submissionTable.number,
        state: schema.submissionTable.state,
        workItemId: schema.submissionTable.workItemId,
        createdAt: schema.submissionTable.createdAt,
        organisationId: schema.submissionTable.organisationId,
        requesterId: schema.submissionTable.requesterId,
        requestTypeId: schema.submissionTable.requestTypeId,
        requestTypeVersionId: schema.submissionTable.requestTypeVersionId,
        formData: schema.submissionTable.formData,
        claimedBy: schema.submissionTable.claimedBy,
        claimedAt: schema.submissionTable.claimedAt,
        version: schema.submissionTable.version,
        requestTypeName: schema.requestTypeTable.name,
        workItemKey: schema.workItemTable.key,
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
          eq(schema.requestTypeTable.workspaceId, c.get("workspaceId")),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Submission not found" });
    const [pinnedVersion] = await db
      .select({
        defaultProjectId: schema.requestTypeVersionTable.defaultProjectId,
        workItemTypeId: schema.requestTypeVersionTable.workItemTypeId,
        formSchema: schema.requestTypeVersionTable.formSchema,
      })
      .from(schema.requestTypeVersionTable)
      .where(
        and(
          eq(schema.requestTypeVersionTable.id, row.requestTypeVersionId),
          eq(schema.requestTypeVersionTable.requestTypeId, row.requestTypeId),
          eq(schema.requestTypeVersionTable.workspaceId, c.get("workspaceId")),
        ),
      )
      .limit(1);
    const messages = await db
      .select({
        id: schema.submissionMessageTable.id,
        actorType: schema.submissionMessageTable.actorType,
        body: schema.submissionMessageTable.body,
        createdAt: schema.submissionMessageTable.createdAt,
      })
      .from(schema.submissionMessageTable)
      .where(eq(schema.submissionMessageTable.submissionId, row.id))
      .orderBy(schema.submissionMessageTable.createdAt);
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      detailSchema.parse({
        id: row.id,
        ref: `SUB-${row.number}`,
        state: row.state,
        workItemKey: row.workItemKey,
        createdAt: row.createdAt,
        organisationId: row.organisationId,
        requesterId: row.requesterId,
        requestTypeId: row.requestTypeId,
        requestTypeVersionId: row.requestTypeVersionId,
        formData: row.formData,
        claimedBy: row.claimedBy,
        claimedAt: row.claimedAt,
        version: row.version,
        requestTypeName: row.requestTypeName,
        suggestedProjectId: pinnedVersion?.defaultProjectId ?? null,
        suggestedWorkItemTypeId: pinnedVersion?.workItemTypeId ?? null,
        formSchema: pinnedVersion?.formSchema ?? { fields: [] },
        messages: messages.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
        })),
      }),
      200,
    );
  })
  .openapi(claimRoute, async (c) => {
    const person = await staffPerson(c);
    const number = Number(c.req.valid("param").ref.slice(4));
    const [row] = await db
      .update(schema.submissionTable)
      .set({
        claimedBy: person.id,
        claimedAt: new Date(),
        version: sql`${schema.submissionTable.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.submissionTable.number, number),
          eq(schema.submissionTable.state, "new"),
          sql`${schema.submissionTable.claimedBy} is null`,
        ),
      )
      .returning({
        number: schema.submissionTable.number,
        state: schema.submissionTable.state,
        workItemId: schema.submissionTable.workItemId,
        createdAt: schema.submissionTable.createdAt,
      });
    if (!row)
      throw new HTTPException(409, {
        message: "Submission has already been claimed or resolved",
      });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      submissionReceiptSchema.parse({
        ref: `SUB-${row.number}`,
        state: row.state,
        workItemKey: null,
        createdAt: row.createdAt,
      }),
      200,
    );
  })
  .openapi(acceptRoute, async (c) => {
    const person = await staffPerson(c);
    const number = Number(c.req.valid("param").ref.slice(4));
    const input = c.req.valid("json");

    // Starting acceptance is itself a triage action. Commit the claim first so a
    // failed configuration/validation attempt still prevents a concurrent withdrawal.
    const [claimed] = await db
      .update(schema.submissionTable)
      .set({
        claimedBy: person.id,
        claimedAt: new Date(),
        version: sql`${schema.submissionTable.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.submissionTable.number, number),
          inArray(schema.submissionTable.state, ["new", "clarifying"]),
          isNull(schema.submissionTable.claimedBy),
        ),
      )
      .returning({ id: schema.submissionTable.id });
    if (!claimed) {
      const [existing] = await db
        .select({
          state: schema.submissionTable.state,
          claimedBy: schema.submissionTable.claimedBy,
        })
        .from(schema.submissionTable)
        .where(eq(schema.submissionTable.number, number))
        .limit(1);
      if (!existing)
        throw new HTTPException(404, { message: "Submission not found" });
      if (
        (existing.state !== "new" && existing.state !== "clarifying") ||
        existing.claimedBy !== person.id
      ) {
        throw new HTTPException(409, {
          message: "Submission has already been handled",
        });
      }
    }

    const result = await acceptSubmissionWorkItem({
      number,
      workspaceId: c.get("workspaceId") as string,
      actorId: person.id,
      projectId: input.projectId,
      typeId: input.typeId,
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      submissionReceiptSchema.parse({
        ref: `SUB-${result.number}`,
        state: "accepted",
        workItemKey: result.workItemKey,
        createdAt: result.createdAt,
      }),
      200,
    );
  })
  .openapi(declineRoute, async (c) => {
    const person = await staffPerson(c);
    const { reason } = c.req.valid("json");
    const number = Number(c.req.valid("param").ref.slice(4));
    const created = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.submissionTable)
        .where(eq(schema.submissionTable.number, number))
        .for("update")
        .limit(1);
      if (!current)
        throw new HTTPException(404, { message: "Submission not found" });
      if (current.state !== "new" && current.state !== "clarifying")
        throw new HTTPException(409, {
          message: "Submission has already been handled",
        });
      await tx.insert(schema.submissionMessageTable).values({
        id: createId(),
        submissionId: current.id,
        authorId: person.id,
        actorType: "triager",
        body: reason,
      });
      const [updated] = await tx
        .update(schema.submissionTable)
        .set({
          state: "declined",
          claimedBy: current.claimedBy ?? person.id,
          claimedAt: current.claimedAt ?? new Date(),
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.submissionTable.id, current.id))
        .returning();
      if (!updated)
        throw new HTTPException(503, { message: "Submission unavailable" });
      const scope = await getSubmissionEventScope(tx, current.id);
      if (!scope)
        throw new HTTPException(404, { message: "Submission not found" });
      await recordSubmissionEvent(tx, {
        kind: "submission.declined",
        ...scope,
        actorId: person.id,
        actorType: "person",
        payload: { ref: `SUB-${updated.number}`, reason },
      });
      return updated;
    });
    await notifySubmissionEvent("submission.declined", {
      ref: `SUB-${created.number}`,
      reason,
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      submissionReceiptSchema.parse({
        ref: `SUB-${created.number}`,
        state: created.state,
        workItemKey: null,
        createdAt: created.createdAt,
      }),
      200,
    );
  })
  .openapi(messageRoute, async (c) => {
    const person = await staffPerson(c);
    const { body } = c.req.valid("json");
    const number = Number(c.req.valid("param").ref.slice(4));
    const created = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.submissionTable)
        .where(eq(schema.submissionTable.number, number))
        .for("update")
        .limit(1);
      if (!current)
        throw new HTTPException(404, { message: "Submission not found" });
      if (current.state !== "new" && current.state !== "clarifying")
        throw new HTTPException(409, {
          message: "Submission cannot be clarified",
        });
      await tx.insert(schema.submissionMessageTable).values({
        id: createId(),
        submissionId: current.id,
        authorId: person.id,
        actorType: "triager",
        body,
      });
      const [updated] = await tx
        .update(schema.submissionTable)
        .set({
          state: "clarifying",
          claimedBy: current.claimedBy ?? person.id,
          claimedAt: current.claimedAt ?? new Date(),
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.submissionTable.id, current.id))
        .returning();
      if (!updated)
        throw new HTTPException(503, { message: "Submission unavailable" });
      const scope = await getSubmissionEventScope(tx, current.id);
      if (!scope)
        throw new HTTPException(404, { message: "Submission not found" });
      await recordSubmissionEvent(tx, {
        kind: "submission.replied",
        ...scope,
        actorId: person.id,
        actorType: "person",
        payload: { ref: `SUB-${updated.number}`, by: "staff" },
      });
      return updated;
    });
    await notifySubmissionEvent("submission.replied", {
      ref: `SUB-${created.number}`,
      by: "staff",
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      submissionReceiptSchema.parse({
        ref: `SUB-${created.number}`,
        state: created.state,
        workItemKey: null,
        createdAt: created.createdAt,
      }),
      200,
    );
  })
  .openapi(duplicateRoute, async (c) => {
    const person = await staffPerson(c);
    const { workItemKey } = c.req.valid("json");
    const number = Number(c.req.valid("param").ref.slice(4));
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.submissionTable)
        .where(eq(schema.submissionTable.number, number))
        .for("update")
        .limit(1);
      if (!current)
        throw new HTTPException(404, { message: "Submission not found" });
      if (current.state !== "new" && current.state !== "clarifying")
        throw new HTTPException(409, {
          message: "Submission has already been handled",
        });
      const [workItem] = await tx
        .select({
          id: schema.workItemTable.id,
          workspaceOrganisationId: schema.workspaceTable.organisationId,
        })
        .from(schema.workItemTable)
        .innerJoin(
          schema.workspaceTable,
          eq(schema.workspaceTable.id, schema.workItemTable.workspaceId),
        )
        .where(eq(schema.workItemTable.key, workItemKey))
        .limit(1);
      if (
        !workItem ||
        workItem.workspaceOrganisationId !== current.organisationId
      )
        throw new HTTPException(404, { message: "Work item not found" });
      await tx
        .insert(schema.requestParticipantTable)
        .values({
          id: createId(),
          workItemId: workItem.id,
          personId: current.requesterId,
          addedBy: person.id,
        })
        .onConflictDoNothing();
      const [updated] = await tx
        .update(schema.submissionTable)
        .set({
          state: "duplicate",
          workItemId: workItem.id,
          claimedBy: current.claimedBy ?? person.id,
          claimedAt: current.claimedAt ?? new Date(),
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.submissionTable.id, current.id))
        .returning();
      if (!updated)
        throw new HTTPException(503, { message: "Submission unavailable" });
      return { submission: updated, workItemKey };
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      submissionReceiptSchema.parse({
        ref: `SUB-${result.submission.number}`,
        state: result.submission.state,
        workItemKey: result.workItemKey,
        createdAt: result.submission.createdAt,
      }),
      200,
    );
  })
  .openapi(duplicatesRoute, async (c) => {
    const number = Number(c.req.valid("param").ref.slice(4));
    const [submission] = await db
      .select({
        id: schema.submissionTable.id,
        organisationId: schema.submissionTable.organisationId,
        formData: schema.submissionTable.formData,
      })
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.number, number))
      .limit(1);
    if (!submission)
      throw new HTTPException(404, { message: "Submission not found" });
    const formData = submission.formData as Record<string, unknown>;
    const title = typeof formData.title === "string" ? formData.title : "";
    if (!title) return c.json({ items: [] }, 200);
    const rows = await db
      .select({
        key: schema.workItemTable.key,
        title: schema.workItemTable.title,
        state: schema.stateTemplateTable.name,
        similarity: sql<number>`similarity(${schema.workItemTable.title}, ${title})`,
      })
      .from(schema.workItemTable)
      .innerJoin(
        schema.workspaceTable,
        eq(schema.workspaceTable.id, schema.workItemTable.workspaceId),
      )
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
          eq(schema.workspaceTable.organisationId, submission.organisationId),
          sql`${schema.workItemTable.createdAt} >= now() - interval '90 days'`,
          sql`similarity(${schema.workItemTable.title}, ${title}) > 0.3`,
        ),
      )
      .orderBy(desc(sql`similarity(${schema.workItemTable.title}, ${title})`))
      .limit(10);
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ items: rows }, 200);
  });

export default routes;
