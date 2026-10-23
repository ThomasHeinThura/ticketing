import type { JsonValue } from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  count,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { Executor } from "../database/executor";
import {
  currentProjectReachPredicate,
  currentWorkspaceReachPredicate,
} from "../database/repositories/identity-scope.repository";
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
import { getActiveStaffPerson } from "../instance/users/repository";

export async function getAttachmentSettings(executor: Executor) {
  return await executor
    .select({
      maxBytes: instanceSettingTable.attachmentMaxBytes,
      maxPerItem: instanceSettingTable.attachmentMaxPerItem,
      allowedExtensions: instanceSettingTable.attachmentAllowedExtensions,
    })
    .from(instanceSettingTable)
    .limit(1);
}

export async function getAttachmentSizeLimit(executor: Executor) {
  return await executor
    .select({ maxBytes: instanceSettingTable.attachmentMaxBytes })
    .from(instanceSettingTable)
    .limit(1);
}

export async function findAttachmentWorkspaceOrganisation(
  executor: Executor,
  workspaceId: string,
) {
  return await executor
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

export async function countWorkItemAttachments(
  executor: Executor,
  workItemId: string,
) {
  return await executor
    .select({ value: count() })
    .from(attachmentTable)
    .where(eq(attachmentTable.workItemId, workItemId));
}

export async function findAttachmentUploader(
  executor: Executor,
  userId: string,
) {
  return await executor
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
}

export async function findAttachmentWorkItemForReach(
  executor: Executor,
  id: string,
) {
  return await executor
    .select({
      id: attachmentTable.id,
      uploadedBy: attachmentTable.uploadedBy,
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
        isNull(projectTable.archivedAt),
      ),
    )
    .limit(1);
}

export async function findIntakeFeatureFlags(
  executor: Executor,
  workspaceId: string,
) {
  return await Promise.all([
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

export async function findSubmissionAttachmentParent(
  executor: Executor,
  input: { number: number; requesterId?: string },
) {
  const rows = await executor
    .select({
      id: submissionTable.id,
      number: submissionTable.number,
      requesterId: submissionTable.requesterId,
      organisationId: submissionTable.organisationId,
      state: submissionTable.state,
      workItemId: submissionTable.workItemId,
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
  return rows;
}

export async function findReachableSubmissionAttachment(
  executor: Executor,
  input: {
    identity: ResolvedIdentity | null;
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
  if (!input.identity) return [];
  const parent =
    input.completion && input.accepted && input.linkedWorkItemId
      ? or(
          eq(attachmentTable.submissionId, input.submissionId),
          eq(attachmentTable.workItemId, input.linkedWorkItemId),
        )
      : input.download
        ? undefined
        : eq(attachmentTable.submissionId, input.submissionId);
  const submissionScope =
    input.identity.side === "customer"
      ? and(
          eq(submissionTable.id, input.submissionId),
          eq(submissionTable.requesterId, input.identity.personId),
        )
      : currentWorkspaceReachPredicate(
          input.identity,
          requestTypeTable.workspaceId,
          executor,
        );
  const reachableLinkedProject = executor
    .select({ id: workItemTable.id })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .where(
      and(
        eq(workItemTable.id, input.linkedWorkItemId ?? ""),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
        currentProjectReachPredicate(
          input.identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
  return await executor
    .select({
      id: attachmentTable.id,
      workItemId: attachmentTable.workItemId,
      submissionId: attachmentTable.submissionId,
      state: attachmentTable.state,
      customerVisible: attachmentTable.customerVisible,
      uploadedBy: attachmentTable.uploadedBy,
    })
    .from(attachmentTable)
    .innerJoin(submissionTable, eq(submissionTable.id, input.submissionId))
    .innerJoin(
      requestTypeTable,
      eq(requestTypeTable.id, submissionTable.requestTypeId),
    )
    .where(
      and(
        eq(attachmentTable.id, input.id),
        eq(attachmentTable.workspaceId, input.workspaceId),
        isNull(attachmentTable.deletedAt),
        parent,
        or(
          and(
            eq(attachmentTable.submissionId, input.submissionId),
            submissionScope,
          ),
          input.accepted && input.linkedWorkItemId
            ? and(
                eq(submissionTable.state, "accepted"),
                eq(attachmentTable.workItemId, input.linkedWorkItemId),
                eq(attachmentTable.workItemId, submissionTable.workItemId),
                input.identity.side === "customer"
                  ? eq(submissionTable.requesterId, input.identity.personId)
                  : undefined,
                input.identity.side === "staff"
                  ? inArray(attachmentTable.workItemId, reachableLinkedProject)
                  : undefined,
              )
            : sql`false`,
        ),
        input.portalDownload
          ? eq(attachmentTable.customerVisible, true)
          : undefined,
      ),
    )
    .limit(1);
}

/** Content read used only after the middleware's minimized authorization-fact check. */
export async function findSubmissionAttachmentContent(
  executor: Executor,
  identity: ResolvedIdentity | null,
  input: {
    id: string;
    workspaceId: string;
    submissionId: string;
    linkedWorkItemId: string | null;
    portal: boolean;
  },
) {
  if (
    !identity ||
    (input.portal ? identity.side !== "customer" : identity.side !== "staff")
  )
    return [];
  const submissionArm = and(
    eq(attachmentTable.submissionId, input.submissionId),
    identity.side === "customer"
      ? eq(submissionTable.requesterId, identity.personId)
      : currentWorkspaceReachPredicate(
          identity,
          requestTypeTable.workspaceId,
          executor,
        ),
  );
  const linkedArm = input.linkedWorkItemId
    ? and(
        eq(submissionTable.state, "accepted"),
        eq(attachmentTable.workItemId, input.linkedWorkItemId),
        eq(attachmentTable.workItemId, submissionTable.workItemId),
        identity.side === "customer"
          ? eq(submissionTable.requesterId, identity.personId)
          : undefined,
        identity.side === "staff"
          ? inArray(
              attachmentTable.workItemId,
              executor
                .select({ id: workItemTable.id })
                .from(workItemTable)
                .innerJoin(
                  projectTable,
                  eq(projectTable.id, workItemTable.projectId),
                )
                .where(
                  and(
                    eq(workItemTable.id, input.linkedWorkItemId),
                    isNull(workItemTable.deletedAt),
                    isNull(workItemTable.archivedAt),
                    isNull(projectTable.deletedAt),
                    currentProjectReachPredicate(
                      identity,
                      projectTable.id,
                      projectTable.workspaceId,
                      projectTable.organisationId,
                      executor,
                    ),
                  ),
                ),
            )
          : undefined,
      )
    : sql`false`;
  return await executor
    .select()
    .from(attachmentTable)
    .innerJoin(submissionTable, eq(submissionTable.id, input.submissionId))
    .innerJoin(
      requestTypeTable,
      eq(requestTypeTable.id, submissionTable.requestTypeId),
    )
    .where(
      and(
        eq(attachmentTable.id, input.id),
        eq(attachmentTable.workspaceId, input.workspaceId),
        eq(attachmentTable.state, "ready"),
        isNull(attachmentTable.deletedAt),
        input.portal ? eq(attachmentTable.customerVisible, true) : undefined,
        or(
          and(
            eq(attachmentTable.submissionId, input.submissionId),
            submissionArm,
          ),
          linkedArm,
        ),
      ),
    )
    .limit(1)
    .then((rows) => rows.map(({ attachment }) => attachment));
}

export async function findSubmissionForPresign(
  executor: Executor,
  input: { submissionId: string; requesterId: string; workspaceId: string },
) {
  return await executor
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

export async function lockSubmissionForPresign(
  executor: Executor,
  input: { submissionId: string; requesterId: string },
) {
  return await executor
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

export async function countSubmissionAttachments(
  executor: Executor,
  submissionId: string,
  fieldKey?: string,
) {
  return await executor
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

export async function findSubmissionFormSchema(
  executor: Executor,
  versionId: string,
) {
  const rows = await executor
    .select({ formSchema: requestTypeVersionTable.formSchema })
    .from(requestTypeVersionTable)
    .where(eq(requestTypeVersionTable.id, versionId))
    .limit(1);
  return rows.map(({ formSchema }) => ({
    formSchema: formSchema as JsonValue,
  }));
}

export async function findAttachmentAuditActor(userId: string) {
  return await getActiveStaffPerson(userId);
}

export async function insertSubmissionAttachment(
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
  return await executor
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

export async function findWorkItemAttachment(
  executor: Executor,
  identity: ResolvedIdentity | null,
  input: { id: string; workspaceId: string; workItemId: string },
) {
  if (!identity || identity.side !== "staff") return [];
  return await executor
    .select()
    .from(attachmentTable)
    .innerJoin(workItemTable, eq(workItemTable.id, attachmentTable.workItemId))
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .where(
      and(
        eq(attachmentTable.id, input.id),
        eq(attachmentTable.workspaceId, input.workspaceId),
        eq(attachmentTable.workItemId, input.workItemId),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    )
    .limit(1)
    .then((rows) => rows.map(({ attachment }) => attachment));
}

export async function findSubmissionCompletionAttachment(
  executor: Executor,
  identity: ResolvedIdentity | null,
  input: {
    id: string;
    workspaceId: string;
    submissionId: string;
    acceptedParentId: string | null;
    requesterId: string;
  },
) {
  if (
    !identity ||
    identity.side !== "customer" ||
    identity.personId !== input.requesterId
  )
    return [];
  const submissionRelation = (transferredParentId: string | null) =>
    exists(
      executor
        .select({ id: submissionTable.id })
        .from(submissionTable)
        .innerJoin(
          requestTypeTable,
          eq(requestTypeTable.id, submissionTable.requestTypeId),
        )
        .where(
          and(
            eq(submissionTable.id, input.submissionId),
            eq(submissionTable.requesterId, identity.personId),
            eq(submissionTable.requesterId, input.requesterId),
            eq(requestTypeTable.workspaceId, input.workspaceId),
            transferredParentId
              ? and(
                  eq(submissionTable.state, "accepted"),
                  eq(submissionTable.workItemId, transferredParentId),
                  eq(attachmentTable.workItemId, submissionTable.workItemId),
                )
              : eq(attachmentTable.submissionId, submissionTable.id),
          ),
        ),
    );
  const parent = or(
    submissionRelation(null),
    input.acceptedParentId
      ? submissionRelation(input.acceptedParentId)
      : sql`false`,
  );
  return await executor
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

export async function lockSubmissionForCompletion(
  executor: Executor,
  input: { submissionId: string; requesterId: string; workspaceId: string },
) {
  return await executor
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

export async function listPortalSubmissionAttachments(
  executor: Executor,
  identity: ResolvedIdentity | null,
  input: {
    submissionId: string;
    workItemId: string | null;
  },
) {
  if (!identity || identity.side !== "customer") return [];
  const parents = [
    eq(attachmentTable.submissionId, input.submissionId),
    ...(input.workItemId
      ? [eq(attachmentTable.workItemId, input.workItemId)]
      : []),
  ];
  return await executor
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
        exists(
          executor
            .select({ one: sql`1` })
            .from(submissionTable)
            .where(
              and(
                eq(submissionTable.id, input.submissionId),
                eq(submissionTable.requesterId, identity.personId),
                or(
                  eq(attachmentTable.submissionId, submissionTable.id),
                  and(
                    eq(submissionTable.state, "accepted"),
                    eq(attachmentTable.workItemId, submissionTable.workItemId),
                  ),
                ),
              ),
            ),
        ),
        eq(attachmentTable.customerVisible, true),
        isNull(attachmentTable.deletedAt),
      ),
    )
    .orderBy(attachmentTable.createdAt);
}

export async function listStaffSubmissionAttachments(
  executor: Executor,
  identity: ResolvedIdentity | null,
  input: { submissionId: string; workItemId: string | null },
) {
  if (!identity || identity.side !== "staff") return [];
  const parents = [
    eq(attachmentTable.submissionId, input.submissionId),
    ...(input.workItemId
      ? [eq(attachmentTable.workItemId, input.workItemId)]
      : []),
  ];
  return await executor
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
    .innerJoin(submissionTable, eq(submissionTable.id, input.submissionId))
    .where(
      and(
        or(...parents),
        isNull(attachmentTable.deletedAt),
        or(
          and(
            eq(attachmentTable.submissionId, input.submissionId),
            currentWorkspaceReachPredicate(
              identity,
              executor
                .select({ id: requestTypeTable.workspaceId })
                .from(requestTypeTable)
                .where(eq(requestTypeTable.id, submissionTable.requestTypeId)),
              executor,
            ),
          ),
          input.workItemId
            ? and(
                eq(submissionTable.state, "accepted"),
                eq(attachmentTable.workItemId, submissionTable.workItemId),
                inArray(
                  attachmentTable.workItemId,
                  executor
                    .select({ id: workItemTable.id })
                    .from(workItemTable)
                    .innerJoin(
                      projectTable,
                      eq(projectTable.id, workItemTable.projectId),
                    )
                    .where(
                      and(
                        currentProjectReachPredicate(
                          identity,
                          projectTable.id,
                          projectTable.workspaceId,
                          projectTable.organisationId,
                          executor,
                        ),
                        isNull(workItemTable.deletedAt),
                        isNull(projectTable.deletedAt),
                        isNull(workItemTable.archivedAt),
                      ),
                    ),
                ),
              )
            : sql`false`,
        ),
      ),
    )
    .orderBy(attachmentTable.createdAt);
}

export async function getSubmissionAttachmentSizeLimit(executor: Executor) {
  return await getAttachmentSizeLimit(executor);
}

export async function deletePendingSubmissionAttachment(
  executor: Executor,
  id: string,
) {
  return await executor
    .delete(attachmentTable)
    .where(
      and(eq(attachmentTable.id, id), eq(attachmentTable.state, "pending")),
    );
}

export async function markSubmissionAttachmentReady(
  executor: Executor,
  input: { id: string; size: number; objectKey: string },
) {
  return await executor
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

export async function findAttachmentWorkItemProject(
  executor: Executor,
  workItemId: string,
) {
  return await executor
    .select({ projectId: workItemTable.projectId })
    .from(workItemTable)
    .where(eq(workItemTable.id, workItemId))
    .limit(1);
}

export async function lockAttachmentWorkItem(
  executor: Executor,
  input: { workItemId: string; workspaceId?: string },
) {
  return await executor
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

export async function deletePendingWorkItemAttachment(
  executor: Executor,
  input: { id: string; workspaceId: string; workItemId: string },
) {
  return await executor
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

export async function insertWorkItemAttachment(
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
  return await executor
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

export async function updateAttachmentReady(
  executor: Executor,
  input: { id: string; size: number; objectKey: string },
) {
  return await executor
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

export async function findPersonForAttachmentDelete(
  executor: Executor,
  userId: string,
) {
  return await executor
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
}

export async function lockWorkItemForAttachmentDelete(
  executor: Executor,
  workItemId: string,
  workspaceId: string,
) {
  return await executor
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

export async function softDeleteAttachment(
  executor: Executor,
  input: { id: string; personId: string; deletedAt: Date },
) {
  return await executor
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

export async function listWorkItemAttachments(
  executor: Executor,
  identity: ResolvedIdentity | null,
  workItemId: string,
) {
  if (!identity || identity.side !== "staff") return [];
  return await executor
    .select()
    .from(attachmentTable)
    .innerJoin(workItemTable, eq(workItemTable.id, attachmentTable.workItemId))
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .where(
      and(
        eq(attachmentTable.workItemId, workItemId),
        ne(attachmentTable.state, "deleted"),
        isNull(attachmentTable.deletedAt),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    )
    .orderBy(attachmentTable.createdAt)
    .then((rows) => rows.map(({ attachment }) => attachment));
}
