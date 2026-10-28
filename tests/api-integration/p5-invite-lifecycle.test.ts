/**
 * Customer invitation lifecycle (CP-20, CP-22..CP-26): create, list, resend, revoke and accept.
 * The credential is hash-only and single-use, every non-valid accept is the same generic 404,
 * a refusal is audited without the credential or the address, and the accept transaction creates
 * the customer person and membership and consumes the invitation in one step.
 */
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { runCustomerInvitationDeliveryJob } from "../../apps/api/src/customer-invitation/delivery/worker";
import { acceptCustomerInvitation } from "../../apps/api/src/customer-invitation/service";
import db, { schema } from "../../apps/api/src/database";
import { grantCustomerOrganisationMembership } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import {
  createCustomerUser,
  credentialFor,
  type InviteWorld,
  inviteWorld,
} from "./helpers/p5-invite";
import {
  approvePendingDeletion,
  ensureAgentSession,
  type PendingDeletionBody,
} from "./helpers/pending-deletion";
import { emailMock, sentWorkspaceInvitationEmails } from "./mocks/email";

const text = (rows: unknown) =>
  JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

let w: InviteWorld;
beforeEach(async () => {
  await resetTestDatabase();
  emailMock.configured = true;
  sentWorkspaceInvitationEmails.length = 0;
  w = await inviteWorld();
});

const acceptPath = (id: string) => `/api/portal/invitations/${id}/accept`;

/** An admitted customer of the organisation whose address is `email` (membership already held). */
async function admittedCustomer(email: string, organisationId = w.org.id) {
  const customer = await createCustomerUser({
    organisationId,
    email,
    person: true,
  });
  await grantCustomerOrganisationMembership(
    organisationId,
    customer.personId as string,
  );
  return customer;
}

function accept(
  user: Awaited<ReturnType<typeof admittedCustomer>>["user"],
  id: string,
  credential: string,
) {
  return w.portal(user, acceptPath(id), {
    method: "POST",
    body: { credential },
  });
}

/** One address of each kind that could never accept here. */
async function unacceptableAddresses() {
  const { createWorkspaceMember } = await import("./helpers/fixtures");
  const staff = await createWorkspaceMember({ role: "member" });
  await db
    .update(schema.userTable)
    .set({ email: "staffaddr@example.test" })
    .where(eq(schema.userTable.id, staff.user.id));
  const elsewhere = await createCustomerUser({
    organisationId: w.otherOrg.id,
    email: "elsewhere@example.test",
    person: true,
  });
  const gone = await createCustomerUser({
    organisationId: w.org.id,
    email: "gone@example.test",
    person: true,
  });
  await db
    .update(schema.personTable)
    .set({ active: false })
    .where(eq(schema.personTable.id, gone.personId as string));
  await admittedCustomer("already@example.test");
  return {
    elsewhereUser: elsewhere.user,
    staff: "staffaddr@example.test",
    other: "elsewhere@example.test",
    gone: "gone@example.test",
    member: "already@example.test",
  };
}

describe("create (CP-20, CP-23)", () => {
  it("stores a hash-only credential, mails the link with the credential in the fragment and never returns it", async () => {
    const response = await w.call(w.owner.user, w.base(), {
      method: "POST",
      body: { email: "New.Person@Example.test" },
    });
    expect(response.status).toBe(201);
    await runCustomerInvitationDeliveryJob();
    const body = (await response.json()) as Record<string, unknown>;
    const credential = credentialFor("new.person@example.test");
    expect(text(body)).not.toContain(credential);
    expect(Object.keys(body)).not.toContain("credentialHash");
    expect(body).toMatchObject({
      email: "new.person@example.test",
      status: "pending",
      delivered: true,
      organisationId: w.org.id,
    });
    const row = await w.rowOf(body.id as string);
    expect(row).toMatchObject({
      scope: "customer",
      role: "customer",
      organisationId: w.org.id,
      workspaceId: w.workspaceId,
      status: "pending",
    });
    expect(row?.credentialHash).toBe(
      createHash("sha256").update(credential).digest("hex"),
    );
    expect(text(row)).not.toContain(credential);
    const mail = sentWorkspaceInvitationEmails.at(-1);
    expect(String(mail?.data.invitationLink)).toBe(
      `http://portal.localhost:5174/invite/${body.id}#t=${credential}`,
    );
    const lifetime = (row?.expiresAt.getTime() ?? 0) - Date.now();
    expect(lifetime).toBeGreaterThan(47 * 3_600_000);
    expect(lifetime).toBeLessThanOrEqual(48 * 3_600_000);
    // 256 bits of entropy, URL-safe.
    expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("does not store the credential or the address in the audit trail", async () => {
    const sent = await w.invite("audited@example.test");
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "invitation.sent"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityId: sent.id,
      organisationId: w.org.id,
      workspaceId: w.workspaceId,
    });
    expect(text(audit)).not.toContain(sent.credential);
    expect(text(audit)).not.toContain("audited@example.test");
  });

  it("is not replayed from a stored idempotent response (the credential is never persisted)", async () => {
    const send = () =>
      w.call(w.owner.user, w.base(), {
        method: "POST",
        body: { email: "idem@example.test" },
      });
    expect((await send()).status).toBe(201);
    // A replay would be a cached 201; a fresh execution finds the pending row.
    expect((await send()).status).toBe(409);
  });

  it("refuses an address with a live pending invitation", async () => {
    await w.invite("dup@example.test");
    const dup = await w.call(w.owner.user, w.base(), {
      method: "POST",
      body: { email: "DUP@example.test" },
    });
    expect(dup.status).toBe(409);
    expect(await db.select().from(schema.invitationTable)).toHaveLength(1);
  });

  it("answers an address that could never accept exactly like any other: 201, an inert pending row, no email, audited by reason only", async () => {
    const addresses = await unacceptableAddresses();
    sentWorkspaceInvitationEmails.length = 0;
    const ids: string[] = [];
    for (const email of [
      addresses.staff,
      addresses.other,
      addresses.gone,
      addresses.member,
    ]) {
      const response = await w.call(w.owner.user, w.base(), {
        method: "POST",
        body: { email },
      });
      expect(response.status, email).toBe(201);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        email,
        status: "pending",
        delivered: true,
        organisationId: w.org.id,
      });
      ids.push(body.id as string);
      const row = await w.rowOf(body.id as string);
      expect(row?.status).toBe("pending");
      expect(row?.credentialHash).toBeNull();
    }
    expect(sentWorkspaceInvitationEmails).toHaveLength(0);
    // Listed as pending like any other.
    const list = (await (await w.call(w.owner.user, w.base())).json()) as {
      invitations: { id: string; status: string }[];
    };
    for (const id of ids)
      expect(list.invitations.find((i) => i.id === id)?.status).toBe("pending");
    // The reason is in the audit trail for the real row id, never in a response.
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "permission.denied"));
    for (const id of ids)
      expect(
        audit.some(
          (row) =>
            row.entityId === id &&
            JSON.stringify(row.after).includes("address_not_invitable"),
        ),
      ).toBe(true);
    // A duplicate create is the same "already pending" as for any address.
    const dup = await w.call(w.owner.user, w.base(), {
      method: "POST",
      body: { email: addresses.staff },
    });
    expect(dup.status).toBe(409);
  });

  it("counts these creates toward the limits and checks the limit before the address", async () => {
    const addresses = await unacceptableAddresses();
    for (let i = 0; i < 20; i += 1) {
      const response = await w.call(w.owner.user, w.base(), {
        method: "POST",
        body: { email: `probe${i}@example.test` },
      });
      expect(response.status).toBe(201);
    }
    for (const email of [
      addresses.staff,
      addresses.other,
      addresses.gone,
      addresses.member,
      "unknown@example.test",
    ]) {
      const response = await w.call(w.owner.user, w.base(), {
        method: "POST",
        body: { email },
      });
      expect(response.status, email).toBe(429);
    }
  });

  it("does not let create reveal whether an address has an account: status, body shape and headers match", async () => {
    const addresses = await unacceptableAddresses();
    const shape = async (email: string) => {
      const response = await w.call(w.owner.user, w.base(), {
        method: "POST",
        body: { email },
      });
      const body = (await response.json()) as Record<string, unknown>;
      const headers = [...response.headers.entries()]
        .filter(([name]) => !["date", "x-request-id"].includes(name))
        .map(([name, value]) =>
          name === "content-length" ? [name, ""] : [name, value],
        )
        .sort();
      return {
        status: response.status,
        keys: Object.keys(body).sort(),
        types: Object.keys(body)
          .sort()
          .map((k) => typeof body[k]),
        status_field: body.status,
        delivered: body.delivered,
        headers: headers.map(([n]) => n),
      };
    };
    const unknown = await shape("nobody@example.test");
    for (const email of [
      addresses.staff,
      addresses.other,
      addresses.gone,
      addresses.member,
    ])
      expect(await shape(email), email).toEqual(unknown);
    expect(unknown.status).toBe(201);
  });

  it("still invites an address with no person yet and an active customer of this organisation without a membership", async () => {
    const fresh = await w.call(w.owner.user, w.base(), {
      method: "POST",
      body: { email: "fresh@example.test" },
    });
    expect(fresh.status).toBe(201);
    await createCustomerUser({
      organisationId: w.org.id,
      email: "known@example.test",
      person: true,
    });
    const known = await w.call(w.owner.user, w.base(), {
      method: "POST",
      body: { email: "known@example.test" },
    });
    expect(known.status).toBe(201);
  });

  it("counts the in-place renewal of an expired row toward the create limits", async () => {
    const old = await w.invite("renewlimit@example.test");
    await db
      .update(schema.invitationTable)
      .set({
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      })
      .where(eq(schema.invitationTable.id, old.id));
    for (let i = 0; i < 19; i += 1)
      await w.invite(`renewfill${i}@example.test`);
    const renewed = await w.invite("renewlimit@example.test");
    expect(renewed.id).toBe(old.id);
    const over = await w.call(w.owner.user, w.base(), {
      method: "POST",
      body: { email: "renew-over@example.test" },
    });
    expect(over.status).toBe(429);
  });

  it("renews an expired pending invitation for the same address instead of failing", async () => {
    const first = await w.invite("renew@example.test");
    await db
      .update(schema.invitationTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitationTable.id, first.id));
    const second = await w.invite("renew@example.test");
    expect(second.id).toBe(first.id);
    expect(second.credential).not.toBe(first.credential);
    const row = await w.rowOf(first.id);
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("answers 409, never 500, when two creates for one address race", async () => {
    const send = () =>
      w.call(w.owner.user, w.base(), {
        method: "POST",
        body: { email: "racecreate@example.test" },
      });
    const statuses = (await Promise.all([send(), send()]))
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([201, 409]);
    expect(await db.select().from(schema.invitationTable)).toHaveLength(1);
  });

  it("limits creates per inviter and answers 429", async () => {
    for (let i = 0; i < 20; i += 1) await w.invite(`bulk${i}@example.test`);
    const over = await w.call(w.owner.user, w.base(), {
      method: "POST",
      body: { email: "bulk-over@example.test" },
    });
    expect(over.status).toBe(429);
  });

  it("uses the configured lifetime and serializes the per-inviter creation quota", async () => {
    await db
      .update(schema.instanceSettingTable)
      .set({
        invitationLifetimeHours: 3,
        customerInvitationCreateWindowMinutes: 30,
        customerInvitationPerInviterLimit: 1,
        customerInvitationPerOrganisationLimit: 10,
      })
      .where(eq(schema.instanceSettingTable.id, "singleton"));

    const send = (email: string) =>
      w.call(w.owner.user, w.base(), {
        method: "POST",
        body: { email },
      });
    const responses = await Promise.all([
      send("configured-a@example.test"),
      send("configured-b@example.test"),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 429,
    ]);

    const [created] = responses.filter((response) => response.status === 201);
    if (!created) throw new Error("configured invitation was not created");
    const body = (await created.json()) as { id: string };
    const row = await w.rowOf(body.id);
    const lifetimeMs = (row?.expiresAt.getTime() ?? 0) - Date.now();
    expect(lifetimeMs).toBeGreaterThan(2.9 * 3_600_000);
    expect(lifetimeMs).toBeLessThanOrEqual(3 * 3_600_000);
  });

  it("enforces the configured organisation quota independently of the inviter quota", async () => {
    await db
      .update(schema.instanceSettingTable)
      .set({
        customerInvitationPerInviterLimit: 10,
        customerInvitationPerOrganisationLimit: 1,
      })
      .where(eq(schema.instanceSettingTable.id, "singleton"));

    expect(
      (
        await w.call(w.owner.user, w.base(), {
          method: "POST",
          body: { email: "org-cap-a@example.test" },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await w.call(w.owner.user, w.base(w.otherOrg.id), {
          method: "POST",
          body: { email: "org-cap-other@example.test" },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await w.call(w.owner.user, w.base(), {
          method: "POST",
          body: { email: "org-cap-b@example.test" },
        })
      ).status,
    ).toBe(429);
  });
});

describe("list (CP-23)", () => {
  it("shows pending, accepted, revoked and expired and never a credential", async () => {
    const pending = await w.invite("p@example.test");
    const accepted = await w.invite("a@example.test");
    const revoked = await w.invite("r@example.test");
    const expired = await w.invite("e@example.test");
    await db
      .update(schema.invitationTable)
      .set({ status: "accepted", credentialHash: null, acceptedAt: new Date() })
      .where(eq(schema.invitationTable.id, accepted.id));
    await db
      .update(schema.invitationTable)
      .set({ status: "canceled", credentialHash: null })
      .where(eq(schema.invitationTable.id, revoked.id));
    await db
      .update(schema.invitationTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitationTable.id, expired.id));
    const body = await w.json<{
      invitations: { id: string; status: string }[];
    }>(await w.call(w.owner.user, w.base()));
    const byId = Object.fromEntries(
      body.invitations.map((i) => [i.id, i.status]),
    );
    expect(byId).toEqual({
      [pending.id]: "pending",
      [accepted.id]: "accepted",
      [revoked.id]: "revoked",
      [expired.id]: "expired",
    });
    for (const invitation of [pending, accepted, revoked, expired])
      expect(text(body)).not.toContain(invitation.credential);
    expect(text(body)).not.toMatch(/credentialHash|credential_hash/);
  });

  it("does not list another organisation's invitations or another workspace's", async () => {
    const mine = await w.invite("mine@example.test");
    const other = await w.invite("other@example.test", w.otherOrg.id);
    const body = await w.json<{ invitations: { id: string }[] }>(
      await w.call(w.owner.user, w.base()),
    );
    expect(body.invitations.map((i) => i.id)).toEqual([mine.id]);
    expect(text(body)).not.toContain(other.id);
    // Another workspace does not serve this organisation, so its own path answers 404 too.
    const foreignRead = await w.call(
      w.foreign.user,
      w.base(w.org.id, w.foreign.workspace.id),
    );
    expect(foreignRead.status).toBe(404);
    expect(text(await foreignRead.text())).not.toContain(mine.id);
  });
});

describe("resend (CP-22)", () => {
  it("an inert row cannot be accepted and resend sends nothing for it; accept fails with the generic 404", async () => {
    const addresses = await unacceptableAddresses();
    const created = (await (
      await w.call(w.owner.user, w.base(), {
        method: "POST",
        body: { email: addresses.other },
      })
    ).json()) as { id: string };
    sentWorkspaceInvitationEmails.length = 0;
    await expect(
      acceptCustomerInvitation({
        userId: addresses.elsewhereUser.id,
        invitationId: created.id,
        credential: "x".repeat(43),
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await w.rowOf(created.id))?.status).toBe("pending");
    await allowResend(created.id);
    const resend = await w.call(
      w.owner.user,
      `${w.base()}/${created.id}/resend`,
      { method: "POST", body: {} },
    );
    expect(resend.status).toBe(200);
    expect(((await resend.json()) as { delivered: boolean }).delivered).toBe(
      true,
    );
    expect(sentWorkspaceInvitationEmails).toHaveLength(0);
    expect((await w.rowOf(created.id))?.credentialHash).toBeNull();
  });

  async function allowResend(id: string) {
    await db
      .update(schema.invitationTable)
      .set({ lastSentAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(schema.invitationTable.id, id));
  }

  it("issues a fresh credential, invalidates the old one and extends expiry", async () => {
    const sent = await w.invite("again@example.test");
    const customer = await admittedCustomer("again@example.test");
    await allowResend(sent.id);
    await db
      .update(schema.invitationTable)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(schema.invitationTable.id, sent.id));
    const response = await w.call(
      w.owner.user,
      `${w.base()}/${sent.id}/resend`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    await runCustomerInvitationDeliveryJob();
    const fresh = credentialFor("again@example.test", sent.id);
    expect(fresh).not.toBe(sent.credential);
    const row = await w.rowOf(sent.id);
    expect(row?.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 47 * 3_600_000,
    );
    expect((await accept(customer.user, sent.id, sent.credential)).status).toBe(
      404,
    );
    expect((await w.rowOf(sent.id))?.status).toBe("pending");
    expect((await accept(customer.user, sent.id, fresh)).status).toBe(200);
  });

  it("has a per-invitation cooldown", async () => {
    const sent = await w.invite("cool@example.test");
    const response = await w.call(
      w.owner.user,
      `${w.base()}/${sent.id}/resend`,
      { method: "POST" },
    );
    expect(response.status).toBe(429);
  });

  it("uses the configured cooldown", async () => {
    const sent = await w.invite("configured-cooldown@example.test");
    await db
      .update(schema.instanceSettingTable)
      .set({ customerInvitationResendCooldownSeconds: 120 })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    await db
      .update(schema.invitationTable)
      .set({ lastSentAt: new Date(Date.now() - 90_000) })
      .where(eq(schema.invitationTable.id, sent.id));
    const response = await w.call(
      w.owner.user,
      `${w.base()}/${sent.id}/resend`,
      { method: "POST" },
    );
    expect(response.status).toBe(429);
  });

  it("refuses a non-pending, a foreign-organisation and a foreign-workspace invitation", async () => {
    const sent = await w.invite("done@example.test");
    await allowResend(sent.id);
    await db
      .update(schema.invitationTable)
      .set({ status: "accepted", credentialHash: null })
      .where(eq(schema.invitationTable.id, sent.id));
    expect(
      (
        await w.call(w.owner.user, `${w.base()}/${sent.id}/resend`, {
          method: "POST",
        })
      ).status,
    ).toBe(409);
    const live = await w.invite("live@example.test");
    await allowResend(live.id);
    expect(
      (
        await w.call(
          w.owner.user,
          `${w.base(w.otherOrg.id)}/${live.id}/resend`,
          { method: "POST" },
        )
      ).status,
    ).toBe(404);
    const crossWorkspace = await w.call(
      w.foreign.user,
      `${w.base(w.org.id, w.foreign.workspace.id)}/${live.id}/resend`,
      { method: "POST" },
    );
    expect(crossWorkspace.status).toBe(404);
  });
});

describe("revoke through the existing pending-action route (CP-22)", () => {
  it("keeps the invitation valid until approval, then invalidates the credential immediately", async () => {
    const sent = await w.invite("revoke@example.test");
    const customer = await admittedCustomer("revoke@example.test");
    await ensureAgentSession(w.owner.user.id);
    const request = await w.call(w.owner.user, `/api/invitation/${sent.id}`, {
      method: "DELETE",
    });
    expect(request.status).toBe(202);
    const pending = (await request.json()) as PendingDeletionBody;
    expect((await w.rowOf(sent.id))?.status).toBe("pending");
    expect((await w.rowOf(sent.id))?.credentialHash).not.toBeNull();
    const approved = await approvePendingDeletion(
      w.app,
      w.owner.user.id,
      pending,
    );
    expect(approved.status).toBe(200);
    const row = await w.rowOf(sent.id);
    expect(row).toMatchObject({ status: "canceled", credentialHash: null });
    expect((await accept(customer.user, sent.id, sent.credential)).status).toBe(
      404,
    );
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "invitation.revoked"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.organisationId).toBe(w.org.id);
  });

  it("lets a reachable lead request and approve revoke, invalidating the credential", async () => {
    const { addMember } = await import("./helpers/reach-world");
    const lead = await addMember(w.workspaceId, "lead");
    const { grantProjectRole } = await import("./helpers/fixtures");
    const [orgProject] = await db
      .select({ id: schema.projectTable.id })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.organisationId, w.org.id));
    // CP-20: creating needs reach to the organisation, here through its project's roster.
    await grantProjectRole(lead.user.id, orgProject?.id as string, [
      "project:read",
    ]);
    await ensureAgentSession(lead.user.id);
    const created = await w.json<{ id: string }>(
      await w.call(lead.user, w.base(), {
        method: "POST",
        body: { email: "leadinvite@example.test" },
      }),
      201,
    );
    await runCustomerInvitationDeliveryJob();
    const customer = await admittedCustomer("leadinvite@example.test");
    const request = await w.call(lead.user, `/api/invitation/${created.id}`, {
      method: "DELETE",
    });
    expect(request.status).toBe(202);
    const pending = (await request.json()) as PendingDeletionBody;
    expect((await w.rowOf(created.id))?.status).toBe("pending");
    expect((await w.rowOf(created.id))?.credentialHash).not.toBeNull();
    await ensureAgentSession(lead.user.id);
    const approved = await approvePendingDeletion(w.app, lead.user.id, pending);
    expect(approved.status).toBe(200);
    expect(await w.rowOf(created.id)).toMatchObject({
      status: "canceled",
      credentialHash: null,
    });
    expect(
      (
        await accept(
          customer.user,
          created.id,
          credentialFor("leadinvite@example.test"),
        )
      ).status,
    ).toBe(404);
  });

  it("denies a member without member:invite and a caller from another tenant", async () => {
    const sent = await w.invite("norevoke@example.test");
    for (const user of [w.member.user, w.foreign.user]) {
      const response = await w.call(user, `/api/invitation/${sent.id}`, {
        method: "DELETE",
      });
      expect([403, 404]).toContain(response.status);
    }
    expect((await w.rowOf(sent.id))?.status).toBe("pending");
  });

  it("denies a lead without reach to the invitation's organisation", async () => {
    const { addMember } = await import("./helpers/reach-world");
    const lead = await addMember(w.workspaceId, "lead");
    const { grantProjectRole } = await import("./helpers/fixtures");
    const [orgProject] = await db
      .select({ id: schema.projectTable.id })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.organisationId, w.org.id));
    await grantProjectRole(lead.user.id, orgProject?.id as string, [
      "project:read",
    ]);
    await ensureAgentSession(lead.user.id);
    const sent = await w.invite("other-org-revoke@example.test", w.otherOrg.id);
    const request = await w.call(lead.user, `/api/invitation/${sent.id}`, {
      method: "DELETE",
    });
    expect(request.status).toBe(404);
    expect((await w.rowOf(sent.id))?.status).toBe("pending");
  });

  it("invalidates a pending request if member:invite is removed before approval", async () => {
    const { addMember } = await import("./helpers/reach-world");
    const lead = await addMember(w.workspaceId, "lead");
    const { grantProjectRole } = await import("./helpers/fixtures");
    const [orgProject] = await db
      .select({ id: schema.projectTable.id })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.organisationId, w.org.id));
    await grantProjectRole(lead.user.id, orgProject?.id as string, [
      "project:read",
    ]);
    await ensureAgentSession(lead.user.id);
    const created = await w.json<{ id: string }>(
      await w.call(lead.user, w.base(), {
        method: "POST",
        body: { email: "revoked-capability@example.test" },
      }),
      201,
    );
    const request = await w.call(lead.user, `/api/invitation/${created.id}`, {
      method: "DELETE",
    });
    expect(request.status).toBe(202);
    const pending = (await request.json()) as PendingDeletionBody;

    const [leadRole] = await db
      .select({
        id: schema.roleTable.id,
        capabilities: schema.roleTable.capabilities,
      })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.scope, "workspace"),
          eq(schema.roleTable.workspaceId, w.workspaceId),
          eq(schema.roleTable.key, "lead"),
        ),
      );
    if (!leadRole) throw new Error("expected the workspace lead role");
    await db
      .update(schema.roleTable)
      .set({
        capabilities: (leadRole.capabilities as string[]).filter(
          (capability) => capability !== "member:invite",
        ),
      })
      .where(eq(schema.roleTable.id, leadRole.id));

    await ensureAgentSession(lead.user.id);
    const approved = await approvePendingDeletion(w.app, lead.user.id, pending);
    // PA-6 step 2: the approver lost member:invite since requesting, so 404 (not 409); the
    // action is still invalidated with its reason.
    expect(approved.status).toBe(404);
    const action = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
    expect(action[0]).toMatchObject({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    expect((await w.rowOf(created.id))?.status).toBe("pending");
  });
});

describe("accept (CP-21, CP-23, CP-24, CP-25)", () => {
  it("consumes the invitation and records customer-grant provenance and the effective projection", async () => {
    const sent = await w.invite("welcome@example.test");
    const customer = await admittedCustomer("welcome@example.test");
    const response = await accept(customer.user, sent.id, sent.credential);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    const row = await w.rowOf(sent.id);
    expect(row).toMatchObject({
      status: "accepted",
      credentialHash: null,
      acceptedPersonId: customer.personId,
    });
    expect(row?.acceptedAt).not.toBeNull();
    const [inviterPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, w.owner.user.id));
    const [membership] = await db
      .select()
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, customer.personId as string),
          eq(schema.membershipTable.scope, "organisation"),
          eq(schema.membershipTable.scopeId, w.org.id),
        ),
      );
    const [grant] = await db
      .select()
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(schema.membershipGrantTable.personId, customer.personId as string),
          eq(schema.membershipGrantTable.scope, "organisation"),
          eq(schema.membershipGrantTable.scopeId, w.org.id),
          eq(schema.membershipGrantTable.sourceKind, "direct"),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    expect(inviterPerson).toBeDefined();
    expect(grant).toMatchObject({
      membershipId: membership?.id,
      personId: customer.personId,
      scope: "organisation",
      scopeId: w.org.id,
      roleId: membership?.roleId,
      sourceKind: "direct",
      directOrigin: "admin",
      grantedByPersonId: inviterPerson?.id,
      seesAll: false,
    });
    // Startup's provenance preflight requires every effective membership to be backed by an
    // active source grant; this acceptance path must not create a grantless row.
    const grantlessMemberships = await db
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .leftJoin(
        schema.membershipGrantTable,
        and(
          eq(
            schema.membershipGrantTable.membershipId,
            schema.membershipTable.id,
          ),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      )
      .where(
        and(
          eq(schema.membershipTable.personId, customer.personId as string),
          eq(schema.membershipTable.scope, "organisation"),
          eq(schema.membershipTable.scopeId, w.org.id),
          isNull(schema.membershipGrantTable.id),
        ),
      );
    expect(grantlessMemberships).toEqual([]);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "invitation.redeemed"));
    expect(audit).toHaveLength(1);
    expect(text(audit)).not.toContain(sent.credential);
    const membershipAudit = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "membership.changed"),
          eq(schema.auditLogTable.entityId, customer.personId as string),
        ),
      );
    expect(membershipAudit).toHaveLength(1);
    expect(membershipAudit[0]).toMatchObject({
      actorId: w.owner.user.id,
      organisationId: w.org.id,
      after: {
        source: "customer_invitation",
        grantedByPersonId: inviterPerson?.id,
      },
    });
  });

  it("is single use: a second accept, even with the same credential, is refused", async () => {
    const sent = await w.invite("once@example.test");
    const customer = await admittedCustomer("once@example.test");
    expect((await accept(customer.user, sent.id, sent.credential)).status).toBe(
      200,
    );
    expect((await accept(customer.user, sent.id, sent.credential)).status).toBe(
      404,
    );
  });

  it("affects exactly one row when two accepts race", async () => {
    const sent = await w.invite("race@example.test");
    const customer = await admittedCustomer("race@example.test");
    const results = await Promise.all([
      accept(customer.user, sent.id, sent.credential),
      accept(customer.user, sent.id, sent.credential),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    expect(
      (await db.select().from(schema.invitationTable)).filter(
        (r) => r.status === "accepted",
      ),
    ).toHaveLength(1);
  });

  it("answers the same generic 404 for every non-valid state", async () => {
    const wrongCredential = await w.invite("wrongcred@example.test");
    const expired = await w.invite("expired@example.test");
    const revoked = await w.invite("revoked@example.test");
    const mismatch = await w.invite("mismatch@example.test");
    const otherOrg = await w.invite("otherorg@example.test");
    const unverified = await w.invite("unverified@example.test");
    await db
      .update(schema.invitationTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitationTable.id, expired.id));
    await db
      .update(schema.invitationTable)
      .set({ status: "canceled", credentialHash: null })
      .where(eq(schema.invitationTable.id, revoked.id));
    const cases = [
      {
        name: "wrong credential",
        user: (await admittedCustomer("wrongcred@example.test")).user,
        id: wrongCredential.id,
        credential: `${wrongCredential.credential.slice(0, -1)}${wrongCredential.credential.endsWith("A") ? "B" : "A"}`,
      },
      {
        name: "expired",
        user: (await admittedCustomer("expired@example.test")).user,
        id: expired.id,
        credential: expired.credential,
      },
      {
        name: "revoked",
        user: (await admittedCustomer("revoked@example.test")).user,
        id: revoked.id,
        credential: revoked.credential,
      },
      {
        name: "address mismatch",
        user: (await admittedCustomer("someone-else@example.test")).user,
        id: mismatch.id,
        credential: mismatch.credential,
      },
      {
        name: "customer of another organisation",
        user: (await admittedCustomer("otherorg@example.test", w.otherOrg.id))
          .user,
        id: otherOrg.id,
        credential: otherOrg.credential,
      },
      {
        name: "unverified address",
        user: (
          await createCustomerUser({
            organisationId: w.org.id,
            email: "unverified@example.test",
            verified: false,
            person: true,
          }).then(async (c) => {
            await grantCustomerOrganisationMembership(
              w.org.id,
              c.personId as string,
            );
            return c;
          })
        ).user,
        id: unverified.id,
        credential: unverified.credential,
      },
      {
        name: "unknown id",
        user: (await admittedCustomer("unknown@example.test")).user,
        id: "no-such-invitation",
        credential: wrongCredential.credential,
      },
    ];
    const bodies = new Set<string>();
    for (const c of cases) {
      const response = await accept(c.user, c.id, c.credential);
      expect(response.status, c.name).toBe(404);
      bodies.add(await response.text());
    }
    expect(bodies.size).toBe(1);
    for (const id of [
      wrongCredential.id,
      expired.id,
      mismatch.id,
      otherOrg.id,
      unverified.id,
    ])
      expect((await w.rowOf(id))?.status).toBe("pending");
    expect((await w.rowOf(revoked.id))?.status).toBe("canceled");
  });

  it("audits each refusal with a reason code, never the credential or the address", async () => {
    const sent = await w.invite("refused@example.test");
    const stranger = await admittedCustomer("stranger@example.test");
    await accept(stranger.user, sent.id, sent.credential);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "permission.denied"));
    expect(audit).toHaveLength(1);
    expect(text(audit)).toContain("address_mismatch");
    expect(audit[0]).toMatchObject({
      entityId: sent.id,
      organisationId: w.org.id,
    });
    expect(text(audit)).not.toContain(sent.credential);
    expect(text(audit)).not.toContain("refused@example.test");
  });

  it("needs the credential: the invitation id alone never grants acceptance", async () => {
    const sent = await w.invite("idonly@example.test");
    const customer = await admittedCustomer("idonly@example.test");
    for (const body of [{}, { credential: "" }, { credential: "short" }]) {
      const response = await w.portal(customer.user, acceptPath(sent.id), {
        method: "POST",
        body,
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect((await w.rowOf(sent.id))?.status).toBe("pending");
  });
});

describe("accept transaction creates the customer identity (CP-24)", () => {
  it("creates the person and the customer membership for an address with no person", async () => {
    const sent = await w.invite("fresh@example.test");
    const fresh = await createCustomerUser({ email: "fresh@example.test" });
    const result = await acceptCustomerInvitation({
      userId: fresh.user.id,
      invitationId: sent.id,
      credential: sent.credential,
    });
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, fresh.user.id));
    expect(person).toMatchObject({
      id: result.personId,
      organisationId: w.org.id,
      side: "customer",
      active: true,
      isPlaceholder: false,
    });
    const memberships = await db
      .select({
        scope: schema.membershipTable.scope,
        scopeId: schema.membershipTable.scopeId,
        roleKey: schema.roleTable.key,
        seesAll: schema.membershipTable.seesAll,
      })
      .from(schema.membershipTable)
      .innerJoin(
        schema.roleTable,
        eq(schema.roleTable.id, schema.membershipTable.roleId),
      )
      .where(eq(schema.membershipTable.personId, result.personId));
    expect(memberships).toEqual([
      {
        scope: "organisation",
        scopeId: w.org.id,
        roleKey: "customer",
        seesAll: false,
      },
    ]);
    expect((await w.rowOf(sent.id))?.status).toBe("accepted");
    // It never creates an agent session.
    expect(
      await db
        .select()
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, fresh.user.id)),
    ).toHaveLength(0);
  });

  it("creates nothing when it refuses: a person who belongs to another organisation", async () => {
    const sent = await w.invite("conflict@example.test");
    const other = await createCustomerUser({
      organisationId: w.otherOrg.id,
      email: "conflict@example.test",
      person: true,
    });
    await expect(
      acceptCustomerInvitation({
        userId: other.user.id,
        invitationId: sent.id,
        credential: sent.credential,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await db
        .select()
        .from(schema.membershipTable)
        .where(eq(schema.membershipTable.personId, other.personId as string)),
    ).toHaveLength(0);
    expect((await w.rowOf(sent.id))?.status).toBe("pending");
  });

  it("rolls the person back when the single-use gate loses", async () => {
    const sent = await w.invite("gate@example.test");
    const fresh = await createCustomerUser({ email: "gate@example.test" });
    await db
      .update(schema.invitationTable)
      .set({ status: "accepted", credentialHash: null })
      .where(eq(schema.invitationTable.id, sent.id));
    await expect(
      acceptCustomerInvitation({
        userId: fresh.user.id,
        invitationId: sent.id,
        credential: sent.credential,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, fresh.user.id)),
    ).toHaveLength(0);
  });
});
