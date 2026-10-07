import { and, count, eq, isNull } from "drizzle-orm";
import type db from "../database";
import {
  attachmentTable,
  instanceSettingTable,
  organisationTable,
  personTable,
  projectTable,
  workItemTable,
  workspaceTable,
} from "../database/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// The schema DSL includes SQL-owned nullable fields that are not part of the
// work-item attachment API contract. Keep these selects stable as the persisted
// row grows; submission-specific metadata is not serialized by work-item routes.
export const attachmentRecordColumns = {
  id: attachmentTable.id,
  workspaceId: attachmentTable.workspaceId,
  organisationId: attachmentTable.organisationId,
  workItemId: attachmentTable.workItemId,
  commentId: attachmentTable.commentId,
  submissionId: attachmentTable.submissionId,
  objectKey: attachmentTable.objectKey,
  filename: attachmentTable.filename,
  mimeType: attachmentTable.mimeType,
  size: attachmentTable.size,
  state: attachmentTable.state,
  customerVisible: attachmentTable.customerVisible,
  uploadedBy: attachmentTable.uploadedBy,
  deletedAt: attachmentTable.deletedAt,
  createdAt: attachmentTable.createdAt,
  updatedAt: attachmentTable.updatedAt,
};

export function lockWorkItemForShare(
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

export function lockWorkItemForAttachmentCompletion(
  executor: Executor,
  workItemId: string,
) {
  return executor
    .select({
      projectId: workItemTable.projectId,
      deletedAt: workItemTable.deletedAt,
      archivedAt: workItemTable.archivedAt,
    })
    .from(workItemTable)
    .where(eq(workItemTable.id, workItemId))
    .for("share");
}

export function getAttachment(executor: Executor, attachmentId: string) {
  return executor
    .select(attachmentRecordColumns)
    .from(attachmentTable)
    .where(eq(attachmentTable.id, attachmentId))
    .limit(1);
}

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

export function getAttachmentMaxBytes(executor: Executor) {
  return executor
    .select({ maxBytes: instanceSettingTable.attachmentMaxBytes })
    .from(instanceSettingTable)
    .limit(1);
}

export function getUploaderPerson(executor: Executor, userId: string) {
  return executor
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
}

export function getWorkspaceOrganisation(
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

export function findAttachmentReach(executor: Executor, attachmentId: string) {
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
        eq(attachmentTable.id, attachmentId),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
}

export function listAttachmentsForWorkItem(
  executor: Executor,
  workItemId: string,
) {
  return executor.query.attachmentTable.findMany({
    columns: { submissionFieldKey: false },
    where: (attachment, { and, eq, isNull, ne }) =>
      and(
        eq(attachment.workItemId, workItemId),
        ne(attachment.state, "deleted"),
        isNull(attachment.deletedAt),
      ),
    orderBy: (attachment, { asc }) => [asc(attachment.createdAt)],
  });
}

export function getWorkItemProjectId(executor: Executor, workItemId: string) {
  return executor
    .select({ projectId: workItemTable.projectId })
    .from(workItemTable)
    .where(eq(workItemTable.id, workItemId))
    .limit(1);
}
