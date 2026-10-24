/**
 * CP-22 delivery answer: `delivered` reports only whether an email provider is configured on the
 * instance. It is identical for a real invitation and an inert row (an address that could never
 * accept), on create and on resend, and a per-send transport failure never changes the response.
 * Resend re-evaluates an inert row.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { grantCustomerOrganisationMembership } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import {
  createCustomerUser,
  type InviteWorld,
  inviteWorld,
} from "./helpers/p5-invite";
import { emailMock, sentWorkspaceInvitationEmails } from "./mocks/email";

const text = (rows: unknown) =>
  JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

let w: InviteWorld;
beforeEach(async () => {
  await resetTestDatabase();
  sentWorkspaceInvitationEmails.length = 0;
  emailMock.configured = true;
  emailMock.failTransport = false;
  w = await inviteWorld();
});

async function member(email: string) {
  const customer = await createCustomerUser({
    organisationId: w.org.id,
    email,
    person: true,
  });
  await grantCustomerOrganisationMembership(
    w.org.id,
    customer.personId as string,
  );
  return customer;
}

async function post(path: string, body: Record<string, unknown>) {
  const response = await w.call(w.owner.user, path, { method: "POST", body });
  const json = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    keys: Object.keys(json).sort(),
    delivered: json.delivered,
    state: json.status,
    id: json.id as string,
  };
}

async function allowResend(id: string) {
  await db
    .update(schema.invitationTable)
    .set({ lastSentAt: new Date(Date.now() - 5 * 60_000) })
    .where(eq(schema.invitationTable.id, id));
}

const resendPath = (id: string) => `${w.base()}/${id}/resend`;

describe("delivered answer (CP-22)", () => {
  for (const configured of [true, false]) {
    it(`is identical for known and unknown addresses on create and resend (provider configured: ${configured})`, async () => {
      emailMock.configured = configured;
      await member("known@example.test");
      const unknown = await post(w.base(), { email: "nobody@example.test" });
      const known = await post(w.base(), { email: "known@example.test" });
      const strip = ({ id: _id, ...rest }: typeof unknown) => rest;
      expect(strip(known)).toEqual(strip(unknown));
      expect(unknown.status).toBe(201);
      expect(unknown.delivered).toBe(configured);

      await allowResend(unknown.id);
      await allowResend(known.id);
      const resentUnknown = await post(resendPath(unknown.id), {});
      const resentKnown = await post(resendPath(known.id), {});
      expect(strip(resentKnown)).toEqual(strip(resentUnknown));
      expect(resentUnknown.status).toBe(200);
      expect(resentUnknown.delivered).toBe(configured);

      // The inert row sent nothing and holds no credential; the real row did.
      expect((await w.rowOf(known.id))?.credentialHash).toBeNull();
      expect((await w.rowOf(unknown.id))?.credentialHash).not.toBeNull();
      const recipients = sentWorkspaceInvitationEmails.map((m) => m.to);
      expect(recipients).not.toContain("known@example.test");
    });
  }

  it("a transport failure does not change the response, and is audited", async () => {
    await member("known@example.test");
    emailMock.failTransport = true;
    const unknown = await post(w.base(), { email: "nobody@example.test" });
    const known = await post(w.base(), { email: "known@example.test" });
    const strip = ({ id: _id, ...rest }: typeof unknown) => rest;
    expect(strip(unknown)).toEqual(strip(known));
    expect(unknown.status).toBe(201);
    expect(unknown.delivered).toBe(true);

    await allowResend(unknown.id);
    await allowResend(known.id);
    const resentUnknown = await post(resendPath(unknown.id), {});
    const resentKnown = await post(resendPath(known.id), {});
    expect(strip(resentUnknown)).toEqual(strip(resentKnown));
    expect(resentUnknown.delivered).toBe(true);

    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, unknown.id));
    expect(text(audit)).toContain('"delivery":"failed"');
    const inertAudit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, known.id));
    expect(text(inertAudit)).not.toContain('"delivery":"failed"');
  });
});

describe("resend re-evaluates an inert row (CP-22)", () => {
  it("gives the row a credential and sends once its address can be invited", async () => {
    const gone = await createCustomerUser({
      organisationId: w.org.id,
      email: "gone@example.test",
      person: true,
    });
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, gone.personId as string));
    const created = await post(w.base(), { email: "gone@example.test" });
    expect((await w.rowOf(created.id))?.credentialHash).toBeNull();

    await allowResend(created.id);
    const still = await post(resendPath(created.id), {});
    expect(still.status).toBe(200);
    expect((await w.rowOf(created.id))?.credentialHash).toBeNull();
    expect(sentWorkspaceInvitationEmails).toHaveLength(0);

    await db
      .update(schema.personTable)
      .set({ active: true })
      .where(eq(schema.personTable.id, gone.personId as string));
    await allowResend(created.id);
    const now = await post(resendPath(created.id), {});
    expect(strip(now)).toEqual(strip(still));
    expect((await w.rowOf(created.id))?.credentialHash).not.toBeNull();
    expect(sentWorkspaceInvitationEmails.map((m) => m.to)).toEqual([
      "gone@example.test",
    ]);
  });
});

function strip<T extends { id: string }>({ id: _id, ...rest }: T) {
  return rest;
}
