/** CP-16 regression: a submission that was marked a duplicate carries a link to an
 * EXISTING work item that may belong to another customer's private request. Only an
 * ACCEPTED submission owns its work item's attachments; a duplicate must not list them
 * (portal or staff). Also: audit rows for staff writes record the staff PERSON id. */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  findSubmissionAttachmentContent,
  findSubmissionCompletionAttachment,
  listPortalSubmissionAttachments,
  listStaffSubmissionAttachments,
} from "../../apps/api/src/attachment/repository";
import db, { schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import {
  addCustomer,
  buildTenant,
  personOf,
  portalRequest,
  type Tenant,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

async function seed() {
  const t = await buildTenant("dup-reach");
  const owner = await addCustomer(t);
  const other = await addCustomer(t);
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.intake", enabled: true, locked: false })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true, locked: false },
    });
  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId: t.workspaceId,
    featureKey: "feature.intake",
    enabled: true,
  });
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: t.workspaceId,
        key: `req-${randomUUID()}`,
        name: "Help",
        group: "General",
        workItemTypeId: t.type.id,
        formSchema: { fields: [] },
      })
      .returning(),
    "request type",
  );
  const version = requireRow(
    await db
      .insert(schema.requestTypeVersionTable)
      .values({
        workspaceId: t.workspaceId,
        requestTypeId: requestType.id,
        number: 1,
        formSchema: { fields: [] },
        workItemTypeId: t.type.id,
      })
      .returning(),
    "version",
  );
  const submit = async (
    who: typeof owner,
    state: string,
    workItemId: string | null,
  ) =>
    requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: who.orgId,
          requesterId: who.person.id,
          requestTypeId: requestType.id,
          requestTypeVersionId: version.id,
          formData: {},
          state,
          workItemId,
          submittedAt: new Date(),
        })
        .returning(),
      "submission",
    );
  // The OWNER's private work item carries a customer-visible, ready attachment.
  const privateAttachment = requireRow(
    await db
      .insert(schema.attachmentTable)
      .values({
        workspaceId: t.workspaceId,
        organisationId: owner.orgId,
        workItemId: t.workItem.id,
        objectKey: `workspace/${t.workspaceId}/work-item/${t.workItem.id}/attachment/a1/secret.pdf`,
        filename: "owner-private.pdf",
        mimeType: "application/pdf",
        size: 10,
        state: "ready",
        customerVisible: true,
        uploadedBy: owner.person.id,
      })
      .returning(),
    "private attachment",
  );
  const accepted = await submit(owner, "accepted", t.workItem.id);
  const duplicate = await submit(other, "duplicate", t.workItem.id);
  return {
    t,
    owner,
    other,
    requestType,
    version,
    accepted,
    duplicate,
    privateAttachment,
  };
}

const names = async (response: Response) =>
  ((await response.json()) as Array<{ filename: string }>).map(
    (row) => row.filename,
  );

describe("submission attachment lists respect the duplicate link (CP-16)", () => {
  let t: Tenant;
  beforeEach(async () => resetTestDatabase());

  it("a duplicate does not expose the linked work item's attachments on the portal", async () => {
    const s = await seed();
    t = s.t;
    const dup = await portalRequest(
      t,
      s.other,
      `/api/portal/submissions/SUB-${s.duplicate.number}/attachments`,
    );
    expect(dup.status).toBe(200);
    expect(await names(dup)).toEqual([]);
    // Control: the ACCEPTED submission of the owner still lists it.
    const ok = await portalRequest(
      t,
      s.owner,
      `/api/portal/submissions/SUB-${s.accepted.number}/attachments`,
    );
    expect(ok.status).toBe(200);
    expect(await names(ok)).toEqual(["owner-private.pdf"]);
  });

  it("direct repository reads bind both parent arms to the actual requester and acceptance state", async () => {
    const s = await seed();
    const visibleOwn = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: s.t.workspaceId,
          organisationId: s.owner.orgId,
          submissionId: s.accepted.id,
          objectKey: `own/${randomUUID()}`,
          filename: "own-submission.txt",
          mimeType: "text/plain",
          size: 1,
          state: "ready",
          customerVisible: true,
          uploadedBy: s.owner.person.id,
        })
        .returning(),
      "own submission attachment",
    );
    const hidden = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: s.t.workspaceId,
          organisationId: s.owner.orgId,
          submissionId: s.accepted.id,
          objectKey: `hidden/${randomUUID()}`,
          filename: "hidden-submission.txt",
          mimeType: "text/plain",
          size: 1,
          state: "ready",
          customerVisible: false,
          uploadedBy: s.owner.person.id,
        })
        .returning(),
      "hidden submission attachment",
    );
    const ownerIdentity = await resolveIdentity({
      userId: s.owner.user.id,
      credential: "session",
    });
    const otherIdentity = await resolveIdentity({
      userId: s.other.user.id,
      credential: "session",
    });
    const ownerRows = await listPortalSubmissionAttachments(db, ownerIdentity, {
      submissionId: s.accepted.id,
      workItemId: s.t.workItem.id,
    });
    expect(ownerRows.map(({ id }) => id)).toEqual(
      expect.arrayContaining([visibleOwn.id, s.privateAttachment.id]),
    );
    expect(ownerRows.map(({ filename }) => filename)).not.toContain(
      "hidden-submission.txt",
    );
    expect(
      await listPortalSubmissionAttachments(db, otherIdentity, {
        submissionId: s.accepted.id,
        workItemId: s.t.workItem.id,
      }),
    ).toEqual([]);
    expect(
      await listPortalSubmissionAttachments(db, ownerIdentity, {
        submissionId: s.duplicate.id,
        workItemId: s.t.workItem.id,
      }),
    ).toEqual([]);
    const staffIdentityBeforeRevocation = await resolveIdentity({
      userId: s.t.requester.user.id,
      credential: "session",
    });
    const staffVisible = await listStaffSubmissionAttachments(
      db,
      staffIdentityBeforeRevocation,
      {
        submissionId: s.accepted.id,
        workItemId: s.t.workItem.id,
      },
    );
    expect(staffIdentityBeforeRevocation).toMatchObject({
      side: "staff",
      personId: expect.any(String),
    });
    expect(staffVisible.map(({ id }) => id)).toContain(s.privateAttachment.id);
    expect(staffVisible.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        visibleOwn.id,
        hidden.id,
        s.privateAttachment.id,
      ]),
    );
    const staffPerson = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, s.t.requester.user.id)),
      "staff person for reach revocation",
    );
    const removedProjectMemberships = await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, staffPerson.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, s.t.workItem.projectId),
        ),
      )
      .returning({ id: schema.membershipTable.personId });
    expect(removedProjectMemberships).not.toHaveLength(0);
    const workspaceReachRows = await listStaffSubmissionAttachments(
      db,
      staffIdentityBeforeRevocation,
      {
        submissionId: s.accepted.id,
        workItemId: s.t.workItem.id,
      },
    );
    expect(workspaceReachRows.map(({ id }) => id)).toEqual(
      expect.arrayContaining([visibleOwn.id, hidden.id]),
    );
    expect(workspaceReachRows).toHaveLength(2);
    expect(workspaceReachRows.map(({ filename }) => filename)).toEqual(
      expect.arrayContaining(["own-submission.txt", "hidden-submission.txt"]),
    );
    expect(workspaceReachRows.map(({ id }) => id)).not.toContain(
      s.privateAttachment.id,
    );
    expect(
      await listStaffSubmissionAttachments(db, staffIdentityBeforeRevocation, {
        submissionId: s.duplicate.id,
        workItemId: s.t.workItem.id,
      }),
    ).toEqual([]);
    const workspaceMembership = await db
      .select({ userId: schema.workspaceUserTable.userId })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, s.t.workspaceId),
          eq(schema.workspaceUserTable.userId, s.t.requester.user.id),
        ),
      );
    expect(workspaceMembership).toHaveLength(1);
    const removedWorkspaceMemberships = await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, s.t.workspaceId),
          eq(schema.workspaceUserTable.userId, s.t.requester.user.id),
        ),
      )
      .returning({ userId: schema.workspaceUserTable.userId });
    expect(removedWorkspaceMemberships).toHaveLength(1);
    expect(
      await listStaffSubmissionAttachments(db, staffIdentityBeforeRevocation, {
        submissionId: s.accepted.id,
        workItemId: s.t.workItem.id,
      }),
    ).toEqual([]);
    expect(
      await listPortalSubmissionAttachments(db, null, {
        submissionId: s.accepted.id,
        workItemId: s.t.workItem.id,
      }),
    ).toEqual([]);
  });

  it("completion and content lookups require the persisted own submission or its accepted link", async () => {
    const s = await seed();
    // The seed's "private" adjective describes its owning work item's reach;
    // this attachment itself is customer-visible and is the accepted-transfer control.
    const acceptedTransferredAttachment = s.privateAttachment;
    const own = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: s.t.workspaceId,
          organisationId: s.owner.orgId,
          submissionId: s.accepted.id,
          objectKey: `own/${randomUUID()}`,
          filename: "completion-own.txt",
          mimeType: "text/plain",
          size: 1,
          state: "ready",
          customerVisible: true,
          uploadedBy: s.owner.person.id,
        })
        .returning(),
      "completion attachment",
    );
    const hiddenOwn = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: s.t.workspaceId,
          organisationId: s.owner.orgId,
          submissionId: s.accepted.id,
          objectKey: `hidden/${randomUUID()}`,
          filename: "completion-hidden.txt",
          mimeType: "text/plain",
          size: 1,
          state: "ready",
          customerVisible: false,
          uploadedBy: s.owner.person.id,
        })
        .returning(),
      "hidden completion attachment",
    );
    const identity = await resolveIdentity({
      userId: s.owner.user.id,
      credential: "session",
    });
    const otherIdentity = await resolveIdentity({
      userId: s.other.user.id,
      credential: "session",
    });
    expect(identity).toMatchObject({
      side: "customer",
      personId: s.owner.person.id,
    });
    expect(otherIdentity).toMatchObject({
      side: "customer",
      personId: s.other.person.id,
    });
    const sameRequesterNonaccepted = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: s.owner.orgId,
          requesterId: s.owner.person.id,
          requestTypeId: s.requestType.id,
          requestTypeVersionId: s.version.id,
          formData: {},
          state: "duplicate",
          workItemId: s.t.workItem.id,
          submittedAt: new Date(),
        })
        .returning(),
      "same requester nonaccepted submission",
    );
    const completionInput = {
      id: own.id,
      workspaceId: s.t.workspaceId,
      submissionId: s.accepted.id,
      acceptedParentId: s.t.workItem.id,
      requesterId: s.owner.person.id,
    };
    expect(
      await findSubmissionCompletionAttachment(db, identity, completionInput),
    ).toHaveLength(1);
    expect(
      await findSubmissionAttachmentContent(db, identity, {
        id: own.id,
        workspaceId: s.t.workspaceId,
        submissionId: s.accepted.id,
        linkedWorkItemId: null,
        portal: true,
      }),
    ).toHaveLength(1);
    expect(
      await findSubmissionCompletionAttachment(db, identity, {
        ...completionInput,
        id: acceptedTransferredAttachment.id,
      }),
    ).toMatchObject([{ id: acceptedTransferredAttachment.id }]);
    expect(
      await findSubmissionCompletionAttachment(db, identity, {
        ...completionInput,
        id: hiddenOwn.id,
      }),
    ).toEqual([]);
    const transferredInput = {
      id: acceptedTransferredAttachment.id,
      workspaceId: s.t.workspaceId,
      submissionId: s.accepted.id,
      linkedWorkItemId: s.t.workItem.id,
      portal: true,
    };
    expect(
      await findSubmissionAttachmentContent(db, identity, transferredInput),
    ).toMatchObject([{ id: acceptedTransferredAttachment.id }]);
    expect(
      await findSubmissionAttachmentContent(db, identity, {
        id: hiddenOwn.id,
        workspaceId: s.t.workspaceId,
        submissionId: s.accepted.id,
        linkedWorkItemId: null,
        portal: true,
      }),
    ).toEqual([]);
    expect(
      await findSubmissionAttachmentContent(db, identity, {
        ...transferredInput,
        submissionId: `missing-${randomUUID()}`,
      }),
    ).toEqual([]);
    expect(
      await findSubmissionAttachmentContent(db, identity, {
        ...transferredInput,
        workspaceId: `foreign-${randomUUID()}`,
      }),
    ).toEqual([]);
    expect(
      await findSubmissionAttachmentContent(
        db,
        otherIdentity,
        transferredInput,
      ),
    ).toEqual([]);
    expect(
      await findSubmissionAttachmentContent(db, identity, {
        ...transferredInput,
        submissionId: s.duplicate.id,
      }),
    ).toEqual([]);
    expect(
      await findSubmissionAttachmentContent(db, identity, {
        ...transferredInput,
        submissionId: sameRequesterNonaccepted.id,
      }),
    ).toEqual([]);
    expect(
      await findSubmissionAttachmentContent(db, identity, {
        ...transferredInput,
        linkedWorkItemId: null,
      }),
    ).toEqual([]);
    expect(
      await findSubmissionAttachmentContent(db, identity, {
        ...transferredInput,
        linkedWorkItemId: `forged-${randomUUID()}`,
      }),
    ).toEqual([]);
    expect(
      await findSubmissionAttachmentContent(db, null, transferredInput),
    ).toEqual([]);
    expect(
      await findSubmissionCompletionAttachment(db, null, completionInput),
    ).toEqual([]);
    for (const submissionId of [`missing-${randomUUID()}`, s.duplicate.id]) {
      expect(
        await findSubmissionCompletionAttachment(db, identity, {
          ...completionInput,
          id: acceptedTransferredAttachment.id,
          submissionId,
        }),
      ).toEqual([]);
    }
    expect(
      await findSubmissionCompletionAttachment(db, identity, {
        ...completionInput,
        id: acceptedTransferredAttachment.id,
        submissionId: sameRequesterNonaccepted.id,
      }),
    ).toEqual([]);
    expect(
      await findSubmissionCompletionAttachment(db, identity, {
        ...completionInput,
        id: acceptedTransferredAttachment.id,
        submissionId: s.accepted.id,
        acceptedParentId: `forged-${randomUUID()}`,
      }),
    ).toEqual([]);
    expect(
      await findSubmissionCompletionAttachment(db, identity, {
        ...completionInput,
        workspaceId: `foreign-${randomUUID()}`,
      }),
    ).toEqual([]);
    expect(
      await findSubmissionCompletionAttachment(db, identity, {
        ...completionInput,
        requesterId: s.other.person.id,
      }),
    ).toEqual([]);
  });

  it("a duplicate does not list the linked work item's attachments to staff either", async () => {
    const s = await seed();
    mockAuthenticatedSession(s.t.requester.user);
    const dup = await s.t.app.request(
      `/api/submissions/SUB-${s.duplicate.number}/attachments`,
    );
    expect(dup.status, await dup.clone().text()).toBe(200);
    expect(await names(dup)).toEqual([]);
    const ok = await s.t.app.request(
      `/api/submissions/SUB-${s.accepted.number}/attachments`,
    );
    expect(ok.status).toBe(200);
    expect(await names(ok)).toEqual(["owner-private.pdf"]);
  });

  it("staff attachment download and request-type writes audit the staff person, not the user", async () => {
    const s = await seed();
    const staff = await personOf(s.t.requester.user.id);
    expect(staff.id).not.toBe(s.t.requester.user.id);
    const own = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: s.t.workspaceId,
          organisationId: s.other.orgId,
          submissionId: s.duplicate.id,
          objectKey: `workspace/${s.t.workspaceId}/submission/${s.duplicate.id}/attachment/a2/own.pdf`,
          filename: "own.pdf",
          mimeType: "application/pdf",
          size: 5,
          state: "ready",
          customerVisible: true,
          uploadedBy: s.other.person.id,
        })
        .returning(),
      "own attachment",
    );
    mockAuthenticatedSession(s.t.requester.user);
    const download = await s.t.app.request(
      `/api/submissions/SUB-${s.duplicate.number}/attachments/${own.id}`,
    );
    expect(download.status, await download.clone().text()).toBe(302);
    const created = await s.t.app.request(
      `/api/request-types?workspaceId=${s.t.workspaceId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Audited",
          group: "General",
          workItemTypeId: s.t.type.id,
          formSchema: { fields: [] },
        }),
      },
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const rows = await db
      .select({
        action: schema.auditLogTable.action,
        actorId: schema.auditLogTable.actorId,
        actorType: schema.auditLogTable.actorType,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.workspaceId, s.t.workspaceId),
          eq(schema.auditLogTable.actorType, "person"),
        ),
      );
    for (const action of ["attachment.downloaded", "request_type.created"]) {
      const row = rows.find((candidate) => candidate.action === action);
      expect(row, action).toBeDefined();
      expect(row?.actorId, action).toBe(staff.id);
    }
  });
});
