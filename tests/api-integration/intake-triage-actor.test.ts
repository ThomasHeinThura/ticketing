/** Regression: staff triage routes must record the acting staff PERSON, not the auth user.
 * `submission.claimed_by` references `person.id`; passing the user id was a foreign-key
 * violation that surfaced as a 500 on POST /api/submissions/{ref}/claim. */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

async function seedSubmission() {
  const member = await createWorkspaceMember({ role: "admin" });
  const staff = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.userId, member.user.id),
          eq(schema.personTable.side, "staff"),
        ),
      ),
    "staff person",
  );
  expect(staff.id).not.toBe(member.user.id);
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.intake", enabled: true, locked: false });
  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId: member.workspace.id,
    featureKey: "feature.intake",
    enabled: true,
  });
  const organisation = requireRow(
    await db
      .insert(schema.organisationTable)
      .values({ key: `customer-${randomUUID()}`, name: "Customer" })
      .returning(),
    "organisation",
  );
  const requester = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        organisationId: organisation.id,
        side: "customer",
        displayName: "Requester",
      })
      .returning(),
    "requester",
  );
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: member.workspace.id,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "work item type",
  );
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: member.workspace.id,
        key: `req-${randomUUID()}`,
        name: "Help",
        group: "General",
        workItemTypeId: type.id,
        formSchema: { fields: [] },
      })
      .returning(),
    "request type",
  );
  const version = requireRow(
    await db
      .insert(schema.requestTypeVersionTable)
      .values({
        workspaceId: member.workspace.id,
        requestTypeId: requestType.id,
        number: 1,
        formSchema: { fields: [] },
        workItemTypeId: type.id,
      })
      .returning(),
    "version",
  );
  const submission = requireRow(
    await db
      .insert(schema.submissionTable)
      .values({
        organisationId: organisation.id,
        requesterId: requester.id,
        requestTypeId: requestType.id,
        requestTypeVersionId: version.id,
        formData: {},
        state: "new",
        submittedAt: new Date(),
      })
      .returning(),
    "submission",
  );
  return { member, staff, submission };
}

describe("staff triage records the acting staff person", () => {
  beforeEach(async () => resetTestDatabase());
  afterEach(() => vi.restoreAllMocks());

  it("claims a submission over HTTP with claimed_by and the audit actor set to the staff person", async () => {
    const { member, staff, submission } = await seedSubmission();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const ref = `SUB-${submission.number}`;

    const claimed = await app.request(`/api/submissions/${ref}/claim`, {
      method: "POST",
    });
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toMatchObject({ ref, claimedBy: staff.id });

    const [row] = await db
      .select({ claimedBy: schema.submissionTable.claimedBy })
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.id, submission.id));
    expect(row?.claimedBy).toBe(staff.id);
    const [audit] = await db
      .select({
        actorId: schema.auditLogTable.actorId,
        actorType: schema.auditLogTable.actorType,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "submission.claimed"),
          eq(schema.auditLogTable.entityId, submission.id),
        ),
      );
    expect(audit).toEqual({ actorId: staff.id, actorType: "person" });

    // Claiming again as the same person is idempotent.
    const again = await app.request(`/api/submissions/${ref}/claim`, {
      method: "POST",
    });
    expect(again.status).toBe(200);
  });

  it("declines over HTTP as the staff person", async () => {
    const { member, submission } = await seedSubmission();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/submissions/SUB-${submission.number}/decline`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Out of scope for this desk." }),
      },
    );
    expect(response.status).toBe(200);
  });
});
