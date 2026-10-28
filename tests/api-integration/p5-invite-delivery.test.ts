/**
 * CP-22 delivery answer: `delivered` reports only whether an email provider is configured on the
 * instance. It is identical for a real invitation and an inert row (an address that could never
 * accept), on create and on resend, and a per-send transport failure never changes the response.
 * Resend re-evaluates an inert row.
 */
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptDeliveryEnvelope } from "../../apps/api/src/customer-invitation/delivery/envelope";
import {
  CustomerInvitationDeliveryKeyring,
  customerInvitationDeliveryKeyring,
} from "../../apps/api/src/customer-invitation/delivery/keyring";
import {
  activateCustomerInvitationDeliveryKey,
  claimCustomerInvitationDeliveries,
  countExpiredCustomerInvitationEnvelopes,
  destroyCustomerInvitationDeliveryKeys,
  enqueueCustomerInvitationDelivery,
  suppressActiveInvitationDeliveries,
} from "../../apps/api/src/customer-invitation/delivery/repository";
import { runCustomerInvitationDeliveryJob } from "../../apps/api/src/customer-invitation/delivery/worker";
import {
  hashCredential,
  newCredential,
} from "../../apps/api/src/customer-invitation/logic";
import {
  acceptCustomerInvitation,
  createCustomerInvitation,
  prepareCustomerInvitation,
} from "../../apps/api/src/customer-invitation/service";
import db, { schema } from "../../apps/api/src/database";
import { customerInvitationDeliveryTable } from "../../apps/api/src/database/schema-customer-invitation-delivery";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { grantCustomerOrganisationMembership } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import {
  createCustomerUser,
  type InviteWorld,
  inviteWorld,
} from "./helpers/p5-invite";
import {
  approvePendingDeletion,
  ensureAgentSession,
  type PendingDeletionBody,
} from "./helpers/pending-deletion";
import {
  emailMock,
  sentWorkspaceInvitationEmails,
  workspaceInvitationPreflightResults,
} from "./mocks/email";

const text = (rows: unknown) =>
  JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

let w: InviteWorld;
beforeEach(async () => {
  await resetTestDatabase();
  sentWorkspaceInvitationEmails.length = 0;
  workspaceInvitationPreflightResults.length = 0;
  emailMock.configured = true;
  emailMock.failTransport = false;
  w = await inviteWorld();
});

afterEach(async () => {
  const active = await db
    .select({ id: customerInvitationDeliveryTable.id })
    .from(customerInvitationDeliveryTable);
  destroyCustomerInvitationDeliveryKeys(active.map(({ id }) => id));
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
      expect(sentWorkspaceInvitationEmails).toHaveLength(0);
      const [unknownQueue] = await db
        .select()
        .from(customerInvitationDeliveryTable)
        .where(eq(customerInvitationDeliveryTable.invitationId, unknown.id));
      const [knownQueue] = await db
        .select()
        .from(customerInvitationDeliveryTable)
        .where(eq(customerInvitationDeliveryTable.invitationId, known.id));
      expect(unknownQueue).toMatchObject({
        state: "queued",
        credentialHash: expect.any(String),
      });
      expect(unknownQueue?.envelope).toEqual(expect.any(String));
      const ephemeralKeyId = decryptDeliveryEnvelope({
        deliveryId: unknownQueue?.id as string,
        invitationId: unknown.id,
        credentialHash: unknownQueue?.credentialHash as string,
        envelope: unknownQueue?.envelope as string,
        ownerId: unknownQueue?.ownerId as string,
      }).keyId;
      expect(knownQueue).toMatchObject({
        state: "suppressed",
        credentialHash: null,
        envelope: null,
        terminalCode: "inert",
      });

      if (configured) await runCustomerInvitationDeliveryJob();
      expect(sentWorkspaceInvitationEmails.map((mail) => mail.to)).toEqual(
        configured ? ["nobody@example.test"] : [],
      );
      expect(workspaceInvitationPreflightResults).toEqual(
        configured ? [true] : [],
      );
      const keyRemainingMs = customerInvitationDeliveryKeyring.remainingMs(
        unknownQueue?.id as string,
        unknownQueue?.ownerId as string,
        ephemeralKeyId,
      );
      if (configured) expect(keyRemainingMs).toBe(0);
      else expect(keyRemainingMs).toBeGreaterThan(0);
      const [initialRealDelivery] = await db
        .select()
        .from(customerInvitationDeliveryTable)
        .where(eq(customerInvitationDeliveryTable.invitationId, unknown.id))
        .orderBy(customerInvitationDeliveryTable.createdAt);
      expect(initialRealDelivery).toMatchObject(
        configured
          ? {
              state: "sent",
              envelope: null,
              credentialHash: null,
              terminalCode: "sent",
            }
          : {
              state: "queued",
              envelope: expect.any(String),
              credentialHash: expect.any(String),
            },
      );

      await allowResend(unknown.id);
      await allowResend(known.id);
      const resentUnknown = await post(resendPath(unknown.id), {});
      const resentKnown = await post(resendPath(known.id), {});
      expect(strip(resentKnown)).toEqual(strip(resentUnknown));
      expect(resentUnknown.status).toBe(200);
      expect(resentUnknown.delivered).toBe(configured);
      if (configured) await runCustomerInvitationDeliveryJob();
      if (configured)
        expect(workspaceInvitationPreflightResults).toEqual([true, true]);

      const unknownDeliveries = await db
        .select()
        .from(customerInvitationDeliveryTable)
        .where(eq(customerInvitationDeliveryTable.invitationId, unknown.id))
        .orderBy(customerInvitationDeliveryTable.createdAt);
      expect(unknownDeliveries).toHaveLength(2);
      expect(unknownDeliveries[0]).toMatchObject({
        state: configured ? "sent" : "suppressed",
        envelope: null,
        credentialHash: null,
        terminalCode: configured ? "sent" : "superseded",
      });
      expect(unknownDeliveries[1]).toMatchObject(
        configured
          ? {
              state: "sent",
              envelope: null,
              credentialHash: null,
              terminalCode: "sent",
            }
          : {
              state: "queued",
              envelope: expect.any(String),
              credentialHash: expect.any(String),
            },
      );

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

    // The HTTP paths never invoke SMTP. The deferred worker owns the bounded retries.
    expect(sentWorkspaceInvitationEmails).toHaveLength(0);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runCustomerInvitationDeliveryJob();
      await db
        .update(customerInvitationDeliveryTable)
        .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
        .where(eq(customerInvitationDeliveryTable.state, "queued"));
    }

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
    const failedDeliveries = await db
      .select()
      .from(customerInvitationDeliveryTable)
      .where(eq(customerInvitationDeliveryTable.invitationId, unknown.id));
    expect(failedDeliveries).toHaveLength(2);
    expect(failedDeliveries.at(-1)).toMatchObject({
      state: "failed",
      envelope: null,
      credentialHash: null,
      terminalCode: "retry_exhausted",
      attempts: 3,
    });
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
    expect(sentWorkspaceInvitationEmails).toHaveLength(0);
    await runCustomerInvitationDeliveryJob();
    expect(sentWorkspaceInvitationEmails.map((m) => m.to)).toEqual([
      "gone@example.test",
    ]);
    expect(sentWorkspaceInvitationEmails[0]?.options.deadlineMs).toBe(5_000);
    expect(sentWorkspaceInvitationEmails[0]?.options.idempotencyKey).toMatch(
      /^customer-invitation-delivery:/u,
    );
  });
});

describe("delivery credential erasure on invitation lifecycle changes", () => {
  it("discards an inactive key and rolls back the invitation when the owning transaction aborts", async () => {
    const identity = await resolveIdentity({
      userId: w.owner.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("owner identity fixture missing");
    const keyring = new CustomerInvitationDeliveryKeyring({
      scheduleCleanup: false,
    });
    const preparedRef: {
      value: Awaited<ReturnType<typeof prepareCustomerInvitation>> | null;
    } = { value: null };
    await expect(
      db.transaction(async (tx) => {
        preparedRef.value = await prepareCustomerInvitation(
          tx,
          {
            actor: {
              userId: w.owner.user.id,
              actorType: "person",
              apiKeyId: null,
            },
            identity,
            scope: {
              workspaceId: w.workspaceId,
              organisationId: w.org.id,
            },
            email: "transaction-rollback@example.test",
          },
          { deliveryKeyring: keyring },
        );
        throw new Error("force outer transaction rollback");
      }),
    ).rejects.toThrow("force outer transaction rollback");
    preparedRef.value?.rollback();

    expect(
      await db
        .select({ id: schema.invitationTable.id })
        .from(schema.invitationTable)
        .where(
          eq(schema.invitationTable.email, "transaction-rollback@example.test"),
        ),
    ).toEqual([]);
    expect(
      await db
        .select({ id: customerInvitationDeliveryTable.id })
        .from(customerInvitationDeliveryTable),
    ).toEqual([]);
    const releasedCapacity = keyring.reserveCapacity();
    releasedCapacity.release();
    keyring.dispose();
  });

  it("returns the same capacity refusal for invitable and inert addresses", async () => {
    const knownCustomer = await createCustomerUser({
      organisationId: w.org.id,
      email: "known-capacity@example.test",
      person: true,
    });
    const identity = await resolveIdentity({
      userId: w.owner.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("owner identity fixture missing");
    const keyring = new CustomerInvitationDeliveryKeyring({
      capacity: 0,
      scheduleCleanup: false,
    });
    const input = {
      actor: {
        userId: w.owner.user.id,
        actorType: "person" as const,
        apiKeyId: null,
      },
      identity,
      scope: { workspaceId: w.workspaceId, organisationId: w.org.id },
    };

    const realResult = await createCustomerInvitation(
      { ...input, email: "new-capacity@example.test" },
      { deliveryKeyring: keyring },
    ).catch((error: unknown) => error);
    const inertResult = await createCustomerInvitation(
      { ...input, email: knownCustomer.user.email },
      { deliveryKeyring: keyring },
    ).catch((error: unknown) => error);

    expect(realResult).toMatchObject({
      status: 503,
      message: "Invitation delivery unavailable",
    });
    expect(inertResult).toMatchObject({
      status: 503,
      message: "Invitation delivery unavailable",
    });
    keyring.dispose();
  });

  it("rolls back invitation changes when process key capacity is unavailable", async () => {
    const created = await post(w.base(), {
      email: "capacity-rollback@example.test",
    });
    const [before] = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, created.id));
    const deliveryCountBefore = await db
      .select({ id: customerInvitationDeliveryTable.id })
      .from(customerInvitationDeliveryTable)
      .where(eq(customerInvitationDeliveryTable.invitationId, created.id));
    const keyring = new CustomerInvitationDeliveryKeyring({
      capacity: 0,
      scheduleCleanup: false,
    });

    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(schema.invitationTable)
          .set({
            expiresAt: new Date((before?.expiresAt.getTime() ?? 0) + 60_000),
          })
          .where(eq(schema.invitationTable.id, created.id));
        await enqueueCustomerInvitationDelivery(
          tx,
          {
            invitationId: created.id,
            credentialHash: hashCredential("B".repeat(43)),
            credential: "B".repeat(43),
            resend: true,
            inert: false,
          },
          keyring,
        );
      }),
    ).rejects.toThrow("Customer invitation delivery is unavailable");

    const [after] = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, created.id));
    const deliveryCountAfter = await db
      .select({ id: customerInvitationDeliveryTable.id })
      .from(customerInvitationDeliveryTable)
      .where(eq(customerInvitationDeliveryTable.invitationId, created.id));
    expect(after?.expiresAt).toEqual(before?.expiresAt);
    expect(deliveryCountAfter).toHaveLength(deliveryCountBefore.length);
    keyring.dispose();
  });

  it("does not claim or erase a fresh row owned by another process", async () => {
    const created = await post(w.base(), {
      email: "foreign-owner@example.test",
    });
    const [queued] = await db
      .select()
      .from(customerInvitationDeliveryTable)
      .where(eq(customerInvitationDeliveryTable.invitationId, created.id));
    expect(queued?.state).toBe("queued");
    await db
      .update(customerInvitationDeliveryTable)
      .set({ ownerId: "00000000-0000-4000-8000-000000000099" })
      .where(eq(customerInvitationDeliveryTable.id, queued?.id as string));

    await runCustomerInvitationDeliveryJob();

    const [untouched] = await db
      .select()
      .from(customerInvitationDeliveryTable)
      .where(eq(customerInvitationDeliveryTable.id, queued?.id as string));
    expect(untouched).toMatchObject({
      state: "queued",
      envelope: queued?.envelope,
      ownerId: "00000000-0000-4000-8000-000000000099",
    });
    expect(sentWorkspaceInvitationEmails).toHaveLength(0);
    destroyCustomerInvitationDeliveryKeys([queued?.id as string]);
  });

  it("claims an active delivery after 51 earlier committed rows with inactive keys", async () => {
    const created = await post(w.base(), {
      email: "activation-window@example.test",
    });
    const superseded = await db.transaction((tx) =>
      suppressActiveInvitationDeliveries(tx, created.id, "superseded"),
    );
    destroyCustomerInvitationDeliveryKeys(superseded);

    const prepared = await db.transaction(async (tx) => {
      const inactiveKeys = [];
      for (let index = 0; index < 51; index++) {
        const { credential } = newCredential();
        const key = await enqueueCustomerInvitationDelivery(
          tx,
          {
            invitationId: created.id,
            credentialHash: hashCredential(credential),
            credential,
            resend: true,
            inert: false,
          },
          customerInvitationDeliveryKeyring,
        );
        if (!key) throw new Error("inactive delivery key missing");
        inactiveKeys.push(key);
      }
      const credential = "C".repeat(43);
      await tx
        .update(schema.invitationTable)
        .set({ credentialHash: hashCredential(credential) })
        .where(eq(schema.invitationTable.id, created.id));
      const targetKey = await enqueueCustomerInvitationDelivery(
        tx,
        {
          invitationId: created.id,
          credentialHash: hashCredential(credential),
          credential,
          resend: true,
          inert: false,
        },
        customerInvitationDeliveryKeyring,
      );
      if (!targetKey) throw new Error("target delivery key missing");
      await tx
        .update(customerInvitationDeliveryTable)
        .set({ nextAttemptAt: new Date(Date.now() - 60_000) })
        .where(
          inArray(
            customerInvitationDeliveryTable.id,
            inactiveKeys.map((key) => key.id),
          ),
        );
      return { targetKey, inactiveKeys };
    });

    const unactivatedClaims = await claimCustomerInvitationDeliveries();
    expect(unactivatedClaims).toEqual([]);
    const targetBefore = requireRow(
      await db
        .select()
        .from(customerInvitationDeliveryTable)
        .where(eq(customerInvitationDeliveryTable.id, prepared.targetKey.id)),
      "unactivated target delivery",
    );
    expect(targetBefore).toMatchObject({ state: "queued", attempts: 0 });

    activateCustomerInvitationDeliveryKey(prepared.targetKey);
    const claims = await claimCustomerInvitationDeliveries();
    expect(claims.map((claim) => claim.id)).toContain(prepared.targetKey.id);
    const targetAfter = requireRow(
      await db
        .select()
        .from(customerInvitationDeliveryTable)
        .where(eq(customerInvitationDeliveryTable.id, prepared.targetKey.id)),
      "activated target delivery",
    );
    expect(targetAfter).toMatchObject({ state: "sending", attempts: 1 });
    expect(prepared.inactiveKeys).toHaveLength(51);
    for (const key of prepared.inactiveKeys) {
      const [inactive] = await db
        .select({
          state: customerInvitationDeliveryTable.state,
          attempts: customerInvitationDeliveryTable.attempts,
        })
        .from(customerInvitationDeliveryTable)
        .where(eq(customerInvitationDeliveryTable.id, key.id));
      expect(inactive).toMatchObject({ state: "queued", attempts: 0 });
    }
  });

  it("cleans expired ciphertext before provider checks, even when SMTP is disabled", async () => {
    const created = await post(w.base(), {
      email: "expired-queue@example.test",
    });
    const [queued] = await db
      .select()
      .from(customerInvitationDeliveryTable)
      .where(eq(customerInvitationDeliveryTable.invitationId, created.id));
    expect(queued?.envelope).toEqual(expect.any(String));
    const expiredKeyId = decryptDeliveryEnvelope({
      deliveryId: queued?.id as string,
      invitationId: created.id,
      credentialHash: queued?.credentialHash as string,
      envelope: queued?.envelope as string,
      ownerId: queued?.ownerId as string,
    }).keyId;
    await db
      .update(customerInvitationDeliveryTable)
      .set({
        createdAt: new Date(Date.now() - 15 * 60_000),
        expiresAt: new Date(Date.now() - 1_000),
      })
      .where(eq(customerInvitationDeliveryTable.id, queued?.id as string));
    expect(await countExpiredCustomerInvitationEnvelopes()).toBe(1);

    emailMock.configured = false;
    await runCustomerInvitationDeliveryJob();

    const [expired] = await db
      .select()
      .from(customerInvitationDeliveryTable)
      .where(eq(customerInvitationDeliveryTable.id, queued?.id as string));
    expect(expired).toMatchObject({
      state: "suppressed",
      envelope: null,
      credentialHash: null,
      terminalCode: "expired",
    });
    expect(await countExpiredCustomerInvitationEnvelopes()).toBe(0);
    expect(
      customerInvitationDeliveryKeyring.remainingMs(
        queued?.id as string,
        queued?.ownerId as string,
        expiredKeyId,
      ),
    ).toBe(0);
    expect(sentWorkspaceInvitationEmails).toHaveLength(0);
  });

  it("erases the queued credential in the accept transaction", async () => {
    const customer = await createCustomerUser({
      organisationId: w.org.id,
      email: "accept-queued@example.test",
      person: false,
    });
    const created = await post(w.base(), { email: customer.user.email });
    const [queued] = await db
      .select()
      .from(customerInvitationDeliveryTable)
      .where(eq(customerInvitationDeliveryTable.invitationId, created.id));
    expect(queued?.state).toBe("queued");
    expect(queued?.envelope).toEqual(expect.any(String));
    const decoded = decryptDeliveryEnvelope({
      deliveryId: queued?.id as string,
      invitationId: created.id,
      credentialHash: queued?.credentialHash as string,
      envelope: queued?.envelope as string,
      ownerId: queued?.ownerId as string,
    });

    await acceptCustomerInvitation({
      userId: customer.user.id,
      invitationId: created.id,
      credential: decoded.credential,
    });

    const [consumed] = await db
      .select()
      .from(customerInvitationDeliveryTable)
      .where(eq(customerInvitationDeliveryTable.id, queued?.id as string));
    expect(consumed).toMatchObject({
      state: "suppressed",
      envelope: null,
      credentialHash: null,
      terminalCode: "accepted",
    });
    expect(
      customerInvitationDeliveryKeyring.remainingMs(
        queued?.id as string,
        queued?.ownerId as string,
        decoded.keyId,
      ),
    ).toBe(0);
    expect(sentWorkspaceInvitationEmails).toHaveLength(0);
  });

  it("erases the queued credential when a revoke is approved", async () => {
    const created = await post(w.base(), {
      email: "revoke-queued@example.test",
    });
    const [queued] = await db
      .select()
      .from(customerInvitationDeliveryTable)
      .where(eq(customerInvitationDeliveryTable.invitationId, created.id));
    expect(queued?.envelope).toEqual(expect.any(String));
    const revokedKeyId = decryptDeliveryEnvelope({
      deliveryId: queued?.id as string,
      invitationId: created.id,
      credentialHash: queued?.credentialHash as string,
      envelope: queued?.envelope as string,
      ownerId: queued?.ownerId as string,
    }).keyId;

    await ensureAgentSession(w.owner.user.id);
    const request = await w.call(
      w.owner.user,
      `/api/invitation/${created.id}`,
      {
        method: "DELETE",
      },
    );
    expect(request.status).toBe(202);
    const pending = (await request.json()) as PendingDeletionBody;
    const approved = await approvePendingDeletion(
      w.app,
      w.owner.user.id,
      pending,
    );
    expect(approved.status).toBe(200);

    const [revoked] = await db
      .select()
      .from(customerInvitationDeliveryTable)
      .where(eq(customerInvitationDeliveryTable.id, queued?.id as string));
    expect(revoked).toMatchObject({
      state: "suppressed",
      envelope: null,
      credentialHash: null,
      terminalCode: "revoked",
    });
    expect(
      customerInvitationDeliveryKeyring.remainingMs(
        queued?.id as string,
        queued?.ownerId as string,
        revokedKeyId,
      ),
    ).toBe(0);
    expect(sentWorkspaceInvitationEmails).toHaveLength(0);
  });
});

function strip<T extends { id: string }>({ id: _id, ...rest }: T) {
  return rest;
}
