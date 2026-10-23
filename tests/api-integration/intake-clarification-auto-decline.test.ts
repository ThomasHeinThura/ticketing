/** IQ-15 / IQ-12 (written, not yet run by the implementer; needs the integration database). */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { autoDeclineStaleClarifications } from "../../apps/api/src/intake/auto-decline";
import { postSubmissionMessage } from "../../apps/api/src/intake/repository";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

async function seed(
  state: "new" | "clarifying",
  clarifyingDaysAgo: number | null,
) {
  const member = await createWorkspaceMember({ role: "admin" });
  const staff = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id))
      .limit(1),
    "staff person",
  );
  // A real admitted customer: user, customer-side person and the canonical organisation-scope
  // `customer` membership. Without that membership `resolveIdentity` is null for the requester
  // and customer-side notification fan-out fails closed by design.
  const principal = await createCustomerPrincipal();
  const organisation = { id: principal.orgId };
  const requester = principal.person;
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
    "type",
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
        state,
        submittedAt: new Date(),
        claimedBy: staff.id,
        claimedAt: new Date(),
        clarifyingSince:
          clarifyingDaysAgo === null
            ? null
            : new Date(Date.now() - clarifyingDaysAgo * 86_400_000),
      })
      .returning(),
    "submission",
  );
  return { member, staff, requester, submission };
}

describe("IQ-15 clarification auto-decline", () => {
  beforeEach(async () => resetTestDatabase());

  it("declines a submission clarifying past the window, marks it reopenable and tells the customer", async () => {
    const { submission, requester } = await seed("clarifying", 15);
    const outcome = await autoDeclineStaleClarifications();
    expect(outcome).toMatchObject({ declined: 1, degraded: false });
    const [row] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.id, submission.id));
    expect(row?.state).toBe("declined");
    expect(row?.autoDeclinedAt).toBeInstanceOf(Date);
    const inbox = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.personId, requester.id));
    expect(inbox.map((n) => n.kind)).toEqual(["submission.declined"]);
    // A second run is a no-op.
    expect(await autoDeclineStaleClarifications()).toMatchObject({
      declined: 0,
    });
  });

  it("leaves a submission inside the window, or not clarifying, alone", async () => {
    await seed("clarifying", 3);
    await seed("new", null);
    expect(await autoDeclineStaleClarifications()).toMatchObject({
      declined: 0,
    });
  });

  it("honours instance_setting.clarification_window_days", async () => {
    await db.execute(
      sql`INSERT INTO instance_setting (id, clarification_window_days) VALUES ('singleton', 2)
          ON CONFLICT (id) DO UPDATE SET clarification_window_days = 2`,
    );
    await seed("clarifying", 3);
    expect(await autoDeclineStaleClarifications()).toMatchObject({
      declined: 1,
    });
  });
});

describe("IQ-12 clarification reply notifies the customer", () => {
  beforeEach(async () => resetTestDatabase());

  it("writes the customer's inbox row in the message transaction and stamps clarifying_since", async () => {
    const { member, submission, staff, requester } = await seed("new", null);
    const ref = `SUB-${submission.number}`;
    await postSubmissionMessage({
      ref,
      workspaceId: member.workspace.id,
      actorId: staff.id,
      actorType: "triager",
      body: "Which environment?",
    });
    const [row] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.id, submission.id));
    expect(row?.state).toBe("clarifying");
    expect(row?.clarifyingSince).toBeInstanceOf(Date);
    const inbox = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.personId, requester.id));
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      kind: "submission.replied",
      resourceType: "submission",
      resourceId: submission.id,
    });
  });
});
