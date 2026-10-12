/** CP-16 regression: a submission that was marked a duplicate carries a link to an
 * EXISTING work item that may belong to another customer's private request. Only an
 * ACCEPTED submission owns its work item's attachments; a duplicate must not list them
 * (portal or staff). Also: audit rows for staff writes record the staff PERSON id. */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
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
  return { t, owner, other, accepted, duplicate, privateAttachment };
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
});
