import { and, count, eq, isNull, ne, or } from "drizzle-orm";
import type db from "../database";
import {
  attachmentTable,
  instanceFeatureFlagTable,
  instanceSettingTable,
  organisationTable,
  personTable,
  projectTable,
  requestTypeTable,
  requestTypeVersionTable,
  submissionTable,
  workItemTable,
  workspaceFeatureFlagTable,
  workspaceTable,
} from "../database/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Transaction;

export function getAttachmentSettings(executor: Executor) {
  return executor
    .select({
      maxBytes: instanceSettingTable.attachmentMaxBytes,
      maxPerItem: instanceSettingTable.attachmentMaxPerItem,
      allowedExtensions: instanceSettingTable.attachmentAllowedExtensions,
    })
    .from(instanceSettingTable)
    .limit(1);
}

export function getAttachmentSizeLimit(executor: Executor) {
  return executor
    .select({ maxBytes: instanceSettingTable.attachmentMaxBytes })
    .from(instanceSettingTable)
    .limit(1);
}

export function findAttachmentWorkspaceOrganisation(
  executor: Executor,
  workspaceId: string,
) {
  return executor
    .select({
      isInternal: organisationTable.isInternal,
      id: organisationTable.id,
    })
    .from(workspaceTable)
    .innerJoin(
      organisationTable,
      eq(workspaceTable.organisationId, organisationTable.id),
    )
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
}

export function countWorkItemAttachments(
  executor: Executor,
  workItemId: string,
) {
  return executor
    .select({ value: count() })
    .from(attachmentTable)
    .where(eq(attachmentTable.workItemId, workItemId));
}

export function findAttachmentUploader(executor: Executor, userId: string) {
  return executor
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
}

export function findAttachmentWorkItemForReach(executor: Executor, id: string) {
  return executor
    .select({
      id: attachmentTable.id,
      workItemId: attachmentTable.workItemId,
      workspaceId: attachmentTable.workspaceId,
      projectId: workItemTable.projectId,
      organisationId: workspaceTable.organisationId,
    })
    .from(attachmentTable)
    .innerJoin(workItemTable, eq(attachmentTable.workItemId, workItemTable.id))
    .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(
      and(
        eq(attachmentTable.id, id),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
}

export function findIntakeFeatureFlags(
  executor: Executor,
  workspaceId: string,
) {
  return Promise.all([
    executor
      .select({
        enabled: instanceFeatureFlagTable.enabled,
        locked: instanceFeatureFlagTable.locked,
      })
      .from(instanceFeatureFlagTable)
      .where(eq(instanceFeatureFlagTable.featureKey, "feature.intake"))
      .limit(1),
    executor
      .select({ enabled: workspaceFeatureFlagTable.enabled })
      .from(workspaceFeatureFlagTable)
      .where(
        and(
          eq(workspaceFeatureFlagTable.workspaceId, workspaceId),
          eq(workspaceFeatureFlagTable.featureKey, "feature.intake"),
        ),
      )
      .limit(1),
  ]);
}

export function findSubmissionAttachmentParent(
  executor: Executor,
  input: { number: number; requesterId?: string },
) {
  return executor
    .select({
      submission: submissionTable,
      workspaceId: requestTypeTable.workspaceId,
    })
    .from(submissionTable)
    .innerJoin(
      requestTypeTable,
      eq(requestTypeTable.id, submissionTable.requestTypeId),
    )
    .where(
      and(
        eq(submissionTable.number, input.number),
        input.requesterId
          ? eq(submissionTable.requesterId, input.requesterId)
          : undefined,
      ),
    )
    .limit(1);
}

export function findReachableSubmissionAttachment(
  executor: Executor,
  input: {
    id: string;
    workspaceId: string;
    submissionId: string;
    linkedWorkItemId: string | null;
    accepted: boolean;
    portalDownload: boolean;
    download: boolean;
    completion: boolean;
  },
) {
  const parent =
    input.completion && input.accepted && input.linkedWorkItemId
      ? or(
          eq(attachmentTable.submissionId, input.submissionId),
          eq(attachmentTable.workItemId, input.linkedWorkItemId),
        )
      : input.download
        ? undefined
        : eq(attachmentTable.submissionId, input.submissionId);
  return executor
    .select()
    .from(attachmentTable)
    .where(
      and(
        eq(attachmentTable.id, input.id),
        eq(attachmentTable.workspaceId, input.workspaceId),
        parent,
        input.portalDownload
          ? eq(attachmentTable.customerVisible, true)
          : undefined,
        isNull(attachmentTable.deletedAt),
      ),
    )
    .limit(1);
}

export function findSubmissionForPresign(
  executor: Executor,
  input: { submissionId: string; requesterId: string; workspaceId: string },
) {
  return executor
    .select({
      id: submissionTable.id,
      requesterId: submissionTable.requesterId,
      state: submissionTable.state,
      organisationId: submissionTable.organisationId,
    })
    .from(submissionTable)
    .innerJoin(
      requestTypeTable,
      eq(requestTypeTable.id, submissionTable.requestTypeId),
    )
    .where(
      and(
        eq(submissionTable.id, input.submissionId),
        eq(submissionTable.requesterId, input.requesterId),
        eq(requestTypeTable.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
}

export function lockSubmissionForPresign(
  executor: Executor,
  input: { submissionId: string; requesterId: string },
) {
  return executor
    .select({
      id: submissionTable.id,
      requesterId: submissionTable.requesterId,
      state: submissionTable.state,
      requestTypeVersionId: submissionTable.requestTypeVersionId,
    })
    .from(submissionTable)
    .where(
      and(
        eq(submissionTable.id, input.submissionId),
        eq(submissionTable.requesterId, input.requesterId),
      ),
    )
    .for("update")
    .limit(1);
}

export function countSubmissionAttachments(
  executor: Executor,
  submissionId: string,
  fieldKey?: string,
) {
  return executor
    .select({ value: count() })
    .from(attachmentTable)
    .where(
      and(
        eq(attachmentTable.submissionId, submissionId),
        fieldKey === undefined
          ? undefined
          : eq(attachmentTable.submissionFieldKey, fieldKey),
      ),
    );
}

export function findSubmissionFormSchema(
  executor: Executor,
  versionId: string,
) {
  return executor
    .select({ formSchema: requestTypeVersionTable.formSchema })
    .from(requestTypeVersionTable)
    .where(eq(requestTypeVersionTable.id, versionId))
    .limit(1);
}

export function insertSubmissionAttachment(
  executor: Executor,
  input: {
    id: string;
    workspaceId: string;
    organisationId: string;
    submissionId: string;
    fieldKey: string | undefined;
    objectKey: string;
    filename: string;
    contentType: string;
    size: number;
    requesterId: string;
  },
) {
  return executor
    .insert(attachmentTable)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      organisationId: input.organisationId,
      submissionId: input.submissionId,
      submissionFieldKey: input.fieldKey ?? null,
      objectKey: input.objectKey,
      filename: input.filename.slice(0, 255),
      mimeType: input.contentType,
      size: input.size,
      state: "pending",
      customerVisible: true,
      uploadedBy: input.requesterId,
    })
    .returning({ id: attachmentTable.id });
}

export function findAttachment(executor: Executor, id: string) {
  return executor
    .select()
    .from(attachmentTable)
    .where(eq(attachmentTable.id, id))
    .limit(1);
}

export function findSubmissionCompletionAttachment(
  executor: Executor,
  input: {
    id: string;
    workspaceId: string;
    submissionId: string;
    acceptedParentId: string | null;
    requesterId: string;
  },
) {
  const parent = input.acceptedParentId
    ? or(
        eq(attachmentTable.submissionId, input.submissionId),
        eq(attachmentTable.workItemId, input.acceptedParentId),
      )
    : eq(attachmentTable.submissionId, input.submissionId);
  return executor
    .select()
    .from(attachmentTable)
    .where(
      and(
        eq(attachmentTable.id, input.id),
        eq(attachmentTable.workspaceId, input.workspaceId),
        parent,
        eq(attachmentTable.uploadedBy, input.requesterId),
        eq(attachmentTable.customerVisible, true),
        isNull(attachmentTable.deletedAt),
      ),
    )
    .for("update")
    .limit(1);
}

export function lockSubmissionForCompletion(
  executor: Executor,
  input: { submissionId: string; requesterId: string; workspaceId: string },
) {
  return executor
    .select({
      id: submissionTable.id,
      requesterId: submissionTable.requesterId,
      state: submissionTable.state,
      workItemId: submissionTable.workItemId,
    })
    .from(submissionTable)
    .innerJoin(
      requestTypeTable,
      eq(requestTypeTable.id, submissionTable.requestTypeId),
    )
    .where(
      and(
        eq(submissionTable.id, input.submissionId),
        eq(submissionTable.requesterId, input.requesterId),
        eq(requestTypeTable.workspaceId, input.workspaceId),
      ),
    )
    .for("update", { of: submissionTable })
    .limit(1);
}

export function listPortalSubmissionAttachments(
  executor: Executor,
  input: {
    submissionId: string;
    workItemId: string | null;
  },
) {
  const parents = [
    eq(attachmentTable.submissionId, input.submissionId),
    ...(input.workItemId
      ? [eq(attachmentTable.workItemId, input.workItemId)]
      : []),
  ];
  return executor
    .select({
      id: attachmentTable.id,
      filename: attachmentTable.filename,
      mimeType: attachmentTable.mimeType,
      size: attachmentTable.size,
      submissionFieldKey: attachmentTable.submissionFieldKey,
      state: attachmentTable.state,
      createdAt: attachmentTable.createdAt,
    })
    .from(attachmentTable)
    .where(
      and(
        or(...parents),
        eq(attachmentTable.customerVisible, true),
        isNull(attachmentTable.deletedAt),
      ),
    )
    .orderBy(attachmentTable.createdAt);
}

export function listStaffSubmissionAttachments(
  executor: Executor,
  input: { submissionId: string; workItemId: string | null },
) {
  const parents = [
    eq(attachmentTable.submissionId, input.submissionId),
    ...(input.workItemId
      ? [eq(attachmentTable.workItemId, input.workItemId)]
      : []),
  ];
  return executor
    .select({
      id: attachmentTable.id,
      filename: attachmentTable.filename,
      mimeType: attachmentTable.mimeType,
      size: attachmentTable.size,
      submissionFieldKey: attachmentTable.submissionFieldKey,
      state: attachmentTable.state,
      customerVisible: attachmentTable.customerVisible,
      createdAt: attachmentTable.createdAt,
    })
    .from(attachmentTable)
    .where(and(or(...parents), isNull(attachmentTable.deletedAt)))
    .orderBy(attachmentTable.createdAt);
}

export function getSubmissionAttachmentSizeLimit(executor: Executor) {
  return getAttachmentSizeLimit(executor);
}

export function deletePendingSubmissionAttachment(
  executor: Executor,
  id: string,
) {
  return executor
    .delete(attachmentTable)
    .where(
      and(eq(attachmentTable.id, id), eq(attachmentTable.state, "pending")),
    );
}

export function markSubmissionAttachmentReady(
  executor: Executor,
  input: { id: string; size: number; objectKey: string },
) {
  return executor
    .update(attachmentTable)
    .set({ state: "ready", size: input.size, objectKey: input.objectKey })
    .where(
      and(
        eq(attachmentTable.id, input.id),
        eq(attachmentTable.state, "pending"),
      ),
    )
    .returning();
}

export function findAttachmentWorkItemProject(
  executor: Executor,
  workItemId: string,
) {
  return executor
    .select({ projectId: workItemTable.projectId })
    .from(workItemTable)
    .where(eq(workItemTable.id, workItemId))
    .limit(1);
}

export function lockAttachmentWorkItem(
  executor: Executor,
  input: { workItemId: string; workspaceId?: string },
) {
  return executor
    .select({
      projectId: workItemTable.projectId,
      deletedAt: workItemTable.deletedAt,
      archivedAt: workItemTable.archivedAt,
      ...(input.workspaceId ? { id: workItemTable.id } : {}),
    })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.id, input.workItemId),
        input.workspaceId
          ? eq(workItemTable.workspaceId, input.workspaceId)
          : undefined,
      ),
    )
    .for("share");
}

export function deletePendingWorkItemAttachment(
  executor: Executor,
  input: { id: string; workspaceId: string; workItemId: string },
) {
  return executor
    .delete(attachmentTable)
    .where(
      and(
        eq(attachmentTable.id, input.id),
        eq(attachmentTable.workspaceId, input.workspaceId),
        eq(attachmentTable.workItemId, input.workItemId),
        eq(attachmentTable.state, "pending"),
      ),
    )
    .returning({ id: attachmentTable.id });
}

export function insertWorkItemAttachment(
  executor: Executor,
  input: {
    id: string;
    workspaceId: string;
    organisationId: string | null;
    workItemId: string;
    objectKey: string;
    filename: string;
    contentType: string;
    size: number;
    customerVisible: boolean;
    uploadedBy: string | null;
  },
) {
  return executor
    .insert(attachmentTable)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      organisationId: input.organisationId,
      workItemId: input.workItemId,
      objectKey: input.objectKey,
      filename: input.filename.slice(0, 255),
      mimeType: input.contentType,
      size: input.size,
      state: "pending",
      customerVisible: input.customerVisible,
      uploadedBy: input.uploadedBy,
    })
    .returning({ id: attachmentTable.id });
}

export function updateAttachmentReady(
  executor: Executor,
  input: { id: string; size: number; objectKey: string },
) {
  return executor
    .update(attachmentTable)
    .set({ state: "ready", size: input.size, objectKey: input.objectKey })
    .where(
      and(
        eq(attachmentTable.id, input.id),
        eq(attachmentTable.state, "pending"),
      ),
    )
    .returning();
}

export function findPersonForAttachmentDelete(
  executor: Executor,
  userId: string,
) {
  return executor
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
}

export function lockWorkItemForAttachmentDelete(
  executor: Executor,
  workItemId: string,
  workspaceId: string,
) {
  return executor
    .select({
      id: workItemTable.id,
      projectId: workItemTable.projectId,
      deletedAt: workItemTable.deletedAt,
      archivedAt: workItemTable.archivedAt,
    })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.id, workItemId),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .for("share");
}

export function softDeleteAttachment(
  executor: Executor,
  input: { id: string; personId: string; deletedAt: Date },
) {
  return executor
    .update(attachmentTable)
    .set({ state: "deleted", deletedAt: input.deletedAt })
    .where(
      and(
        eq(attachmentTable.id, input.id),
        eq(attachmentTable.uploadedBy, input.personId),
        ne(attachmentTable.state, "deleted"),
      ),
    )
    .returning();
}

export function findAttachmentObjectKey(executor: Executor, id: string) {
  return executor
    .select({ objectKey: attachmentTable.objectKey })
    .from(attachmentTable)
    .where(eq(attachmentTable.id, id))
    .limit(1);
}

export function listWorkItemAttachments(
  executor: Executor,
  workItemId: string,
) {
  return executor
    .select()
    .from(attachmentTable)
    .where(
      and(
        eq(attachmentTable.workItemId, workItemId),
        ne(attachmentTable.state, "deleted"),
        isNull(attachmentTable.deletedAt),
      ),
    )
    .orderBy(attachmentTable.createdAt);
}
