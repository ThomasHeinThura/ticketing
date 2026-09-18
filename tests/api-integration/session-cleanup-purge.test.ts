/**
 * `session-cleanup` — the half of `docs/01-architecture/background-jobs.md`'s job that this
 * pull request implements (expired sessions), and the legal-hold rule it must honour.
 *
 * `data-model.md` §2: "An **open** row (`lifted_at is null`) suspends `audit-purge`, the
 * soft-delete purge in `session-cleanup`, `attachment-gc` and every hard delete for that
 * scope." These tests are what makes that sentence true for the one scope the live schema can
 * resolve today.
 *
 * Every hold test is two-sided — an equivalent un-held session is deleted in the same run —
 * so a passing assertion cannot be "nothing was deleted because nothing matched".
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { withJobLease } from "../../apps/api/src/scheduler/leader-lock";
import {
  deleteExpiredSessions,
  runSessionCleanup,
} from "../../apps/api/src/scheduler/session-cleanup";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const HOUR_MS = 60 * 60 * 1000;

async function makeOrganisation(label: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `session-cleanup-${label}-${randomUUID()}`,
        name: `Session Cleanup ${label}`,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeOrganisation",
  );
}

async function makePerson(userId: string, organisationId: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId,
        organisationId,
        side: "staff",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makePerson",
  );
}

async function makeSession(userId: string, expired: boolean) {
  const now = new Date();
  const createdAt = new Date(now.getTime() - 2 * HOUR_MS);
  return requireRow(
    await db
      .insert(schema.sessionTable)
      .values({
        id: `session-${randomUUID()}`,
        token: `token-${randomUUID()}`,
        userId,
        expiresAt: new Date(
          expired ? now.getTime() - HOUR_MS : now.getTime() + HOUR_MS,
        ),
        createdAt,
        updatedAt: createdAt,
      })
      .returning(),
    "makeSession",
  );
}

async function sessionExists(sessionId: string) {
  const [row] = await db
    .select({ id: schema.sessionTable.id })
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.id, sessionId));
  return row !== undefined;
}

async function placeHold(
  scope: "organisation" | "person",
  scopeId: string,
  placedBy: string,
) {
  return requireRow(
    await db
      .insert(schema.legalHoldTable)
      .values({
        scope,
        scopeId,
        placedBy,
        reason: "integration test hold",
      })
      .returning(),
    "placeHold",
  );
}

describe("API integration: session-cleanup's expired-session purge and legal hold", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("the purge itself", () => {
    it("deletes expired sessions and leaves unexpired ones alone", async () => {
      const member = await createWorkspaceMember();
      const expired = await makeSession(member.user.id, true);
      const live = await makeSession(member.user.id, false);

      const deleted = await deleteExpiredSessions();

      expect(deleted).toBe(1);
      expect(await sessionExists(expired.id)).toBe(false);
      expect(await sessionExists(live.id)).toBe(true);
    });

    it("deletes an expired session for a user with no person row", async () => {
      // NULL-safe on purpose: no `person` row means no organisation to hold, so the session
      // is ordinary expired data. Pinned because the opposite is the tempting reading.
      const member = await createWorkspaceMember();
      const session = await makeSession(member.user.id, true);

      expect(await deleteExpiredSessions()).toBe(1);
      expect(await sessionExists(session.id)).toBe(false);
    });

    it("is idempotent — a second run finds nothing left to delete", async () => {
      const member = await createWorkspaceMember();
      await makeSession(member.user.id, true);

      expect(await deleteExpiredSessions()).toBe(1);
      expect(await deleteExpiredSessions()).toBe(0);
    });
  });

  describe("an open legal hold suspends the delete", () => {
    it("keeps an expired session whose person's ORGANISATION is held, and deletes an un-held one", async () => {
      const held = await createWorkspaceMember();
      const unheld = await createWorkspaceMember();

      const heldOrg = await makeOrganisation("held");
      const unheldOrg = await makeOrganisation("unheld");
      await makePerson(held.user.id, heldOrg.id);
      await makePerson(unheld.user.id, unheldOrg.id);
      await placeHold("organisation", heldOrg.id, held.user.id);

      const heldSession = await makeSession(held.user.id, true);
      const unheldSession = await makeSession(unheld.user.id, true);

      expect(await deleteExpiredSessions()).toBe(1);

      expect(await sessionExists(heldSession.id)).toBe(true);
      expect(await sessionExists(unheldSession.id)).toBe(false);
    });

    it("keeps an expired session whose PERSON is held, and deletes an un-held one", async () => {
      const held = await createWorkspaceMember();
      const unheld = await createWorkspaceMember();

      const org = await makeOrganisation("person-scope");
      const heldPerson = await makePerson(held.user.id, org.id);
      await makePerson(unheld.user.id, org.id);
      await placeHold("person", heldPerson.id, held.user.id);

      const heldSession = await makeSession(held.user.id, true);
      const unheldSession = await makeSession(unheld.user.id, true);

      expect(await deleteExpiredSessions()).toBe(1);

      expect(await sessionExists(heldSession.id)).toBe(true);
      expect(await sessionExists(unheldSession.id)).toBe(false);
    });

    it("keeps a held organisation's session even when the session is long expired", async () => {
      const member = await createWorkspaceMember();
      const org = await makeOrganisation("long-expired");
      await makePerson(member.user.id, org.id);
      await placeHold("organisation", org.id, member.user.id);

      const session = await makeSession(member.user.id, true);

      expect(await deleteExpiredSessions()).toBe(0);
      expect(await sessionExists(session.id)).toBe(true);
    });

    it("deletes the session once the hold is lifted", async () => {
      const member = await createWorkspaceMember();
      const org = await makeOrganisation("lifted");
      await makePerson(member.user.id, org.id);
      const hold = await placeHold("organisation", org.id, member.user.id);
      const session = await makeSession(member.user.id, true);

      expect(await deleteExpiredSessions()).toBe(0);
      expect(await sessionExists(session.id)).toBe(true);

      await db
        .update(schema.legalHoldTable)
        .set({ liftedAt: new Date(), liftedBy: member.user.id })
        .where(eq(schema.legalHoldTable.id, hold.id));

      expect(await deleteExpiredSessions()).toBe(1);
      expect(await sessionExists(session.id)).toBe(false);
    });

    it("does not hold a session whose person belongs to a DIFFERENT organisation's hold", async () => {
      // The hold must only reach its own tenant. Without this, a `scope_id` comparison that
      // accidentally dropped the `scope = 'organisation'` half would pass every test above.
      const member = await createWorkspaceMember();
      const ownOrg = await makeOrganisation("own");
      const otherOrg = await makeOrganisation("other");
      await makePerson(member.user.id, ownOrg.id);
      await placeHold("organisation", otherOrg.id, member.user.id);

      const session = await makeSession(member.user.id, true);

      expect(await deleteExpiredSessions()).toBe(1);
      expect(await sessionExists(session.id)).toBe(false);
    });
  });

  describe("the job wrapper", () => {
    it("runs under the lease and reports what it deleted", async () => {
      const member = await createWorkspaceMember();
      await makeSession(member.user.id, true);

      const outcome = await runSessionCleanup();

      expect(outcome.sessionsDeleted).toBe(1);
      expect(outcome.degraded).toBeUndefined();
    });

    it("does nothing when another replica holds the lease", async () => {
      const member = await createWorkspaceMember();
      const session = await makeSession(member.user.id, true);

      await withJobLease(
        "session-cleanup",
        async () => {
          const outcome = await runSessionCleanup();
          // The other holder's run is a no-op, not an error and not a delete.
          expect(outcome.sessionsDeleted).toBe(0);
        },
        () => {
          throw new Error("expected the outer caller to hold the lease");
        },
      );

      expect(await sessionExists(session.id)).toBe(true);
    });
  });

  describe("the legal_hold table's own invariants", () => {
    it("allows at most one OPEN hold per scope, and a new one after a lift", async () => {
      const member = await createWorkspaceMember();
      const org = await makeOrganisation("unique-open");
      const first = await placeHold("organisation", org.id, member.user.id);

      await expect(
        placeHold("organisation", org.id, member.user.id),
      ).rejects.toThrow();

      await db
        .update(schema.legalHoldTable)
        .set({ liftedAt: new Date(), liftedBy: member.user.id })
        .where(eq(schema.legalHoldTable.id, first.id));

      await expect(
        placeHold("organisation", org.id, member.user.id),
      ).resolves.toBeDefined();
    });

    it("allows one open hold per scope independently — organisation and person do not clash", async () => {
      const member = await createWorkspaceMember();
      const org = await makeOrganisation("both-scopes");
      const person = await makePerson(member.user.id, org.id);

      await placeHold("organisation", org.id, member.user.id);
      await expect(
        placeHold("person", person.id, member.user.id),
      ).resolves.toBeDefined();
    });

    it("rejects a scope outside the two data-model.md names", async () => {
      const member = await createWorkspaceMember();

      await expect(
        placeHold("workspace" as "organisation", "any-id", member.user.id),
      ).rejects.toThrow();
    });

    it("creates the partial unique index data-model.md § Indexing specifies", async () => {
      const result = await db.execute<{ indexdef: string }>(sql`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'legal_hold'
          AND indexname = 'legal_hold_scope_scope_id_open_unique'
      `);

      expect(result.rows[0]?.indexdef).toContain("WHERE");
      expect(result.rows[0]?.indexdef).toContain("lifted_at IS NULL");
    });
  });
});
