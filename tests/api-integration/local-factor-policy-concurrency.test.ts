import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createMfaResetChallenge,
  createPendingActionChallenge,
  issueMfaResetToken,
  issuePendingActionToken,
} from "../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";
import { createCredentialBoundPendingAction } from "./helpers/pending-action";

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
});

async function setupRole() {
  await db.insert(schema.roleTable).values({
    id: "factor-policy-race-role",
    scope: "instance",
    workspaceId: null,
    key: "factor-race",
    name: "Factor race",
    rank: 10,
    capabilities: [],
  });
}

async function waitForLifecycleBlocker(
  observer: import("pg").PoolClient,
  blockerPid: number,
  progressed: () => Promise<boolean>,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ pid: number; query: string }>(
      `SELECT l.pid, a.query
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE l.locktype = 'advisory'
         AND l.classid = hashtext('taskdesk:pending-action-lifecycle')::oid
         AND l.objid = hashtext('global')::oid
         AND l.objsubid = 2 AND NOT l.granted
         AND $1 = ANY(pg_blocking_pids(l.pid))`,
      [blockerPid],
    );
    if (result.rows[0]) {
      return {
        state: "waiting" as const,
        pid: result.rows[0].pid,
        query: result.rows[0].query,
      };
    }
    if (await progressed()) return { state: "progressed" as const };
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    "Step-up producer reached neither lifecycle wait nor observable database progress",
  );
}

async function hasPendingActionChallenge(
  observer: import("pg").PoolClient,
  pendingActionId: string,
) {
  const result = await observer.query(
    `SELECT id FROM step_up_confirmation
     WHERE binding_kind = 'pending_action' AND pending_action_id = $1
       AND state = 'challenge'`,
    [pendingActionId],
  );
  return (result.rowCount ?? 0) > 0;
}

async function hasIssuedPendingActionProof(
  observer: import("pg").PoolClient,
  challengeId: string,
) {
  const result = await observer.query(
    `SELECT id FROM step_up_confirmation WHERE id = $1 AND state = 'issued'`,
    [challengeId],
  );
  return result.rowCount === 1;
}

async function hasOperationChallenge(
  observer: import("pg").PoolClient,
  sessionId: string,
) {
  const result = await observer.query(
    `SELECT id FROM step_up_confirmation
     WHERE binding_kind = 'operation' AND session_id = $1
       AND operation_key = 'mfa_reset' AND state = 'challenge'`,
    [sessionId],
  );
  return (result.rowCount ?? 0) > 0;
}

async function prepareStepUpAdmissionFixture(label: string) {
  const { user, workspace } = await createWorkspaceMember({ role: "admin" });
  await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, user.id));
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id));
  if (!person) throw new Error("Step-up admission person is unavailable");
  const sessionId = `step-up-admission-${label}`;
  const now = new Date();
  await db.insert(schema.sessionTable).values({
    id: sessionId,
    token: `token-${sessionId}`,
    userId: user.id,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: now,
    updatedAt: now,
  });
  const pendingActionId = await createCredentialBoundPendingAction({
    requesterPersonId: person.id,
    workspaceId: workspace.id,
    organisationId: workspace.organisationId,
    credentialType: "session",
    credentialId: sessionId,
  });
  await db
    .update(schema.pendingActionTable)
    .set({ confirmationRequired: "typed_name_step_up" })
    .where(eq(schema.pendingActionTable.id, pendingActionId));
  return { user, person, sessionId, pendingActionId };
}

async function expectActionRowAvailable(
  client: import("pg").PoolClient,
  id: string,
) {
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT id FROM pending_action WHERE id = $1 FOR UPDATE NOWAIT",
      [id],
    );
  } finally {
    await client.query("ROLLBACK");
  }
}

describe("local-factor and step-up transaction invariants", () => {
  it("admits challenge creation before it can lock the action row", async () => {
    const fixture = await prepareStepUpAdmissionFixture("create");
    const pool = new Pool({
      connectionString: process.env.TASKDESK_DATABASE_URL,
      max: 3,
    });
    const blocker = await pool.connect();
    const observer = await pool.connect();
    const probe = await pool.connect();
    let create: ReturnType<typeof createPendingActionChallenge> | undefined;
    let gateHeld = false;
    try {
      await blocker.query("BEGIN");
      gateHeld = true;
      const { rows } = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const blockerPid = requireRow(rows, "challenge blocker PID query").pid;
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('taskdesk:pending-action-lifecycle'), hashtext('global'))",
      );
      create = createPendingActionChallenge({
        personId: fixture.person.id,
        sessionId: fixture.sessionId,
        pendingActionId: fixture.pendingActionId,
      });
      const admission = await waitForLifecycleBlocker(
        observer,
        blockerPid,
        () => hasPendingActionChallenge(observer, fixture.pendingActionId),
      );
      expect(admission.state).toBe("waiting");

      // The producer is observably waiting on L. Its first PA row lock has not run.
      await expectActionRowAvailable(probe, fixture.pendingActionId);
      const actionRows = await probe.query(
        "SELECT id FROM pending_action WHERE id = $1",
        [fixture.pendingActionId],
      );
      expect(actionRows.rowCount).toBe(1);

      await blocker.query("COMMIT");
      gateHeld = false;
      const createdChallenge = create;
      if (!createdChallenge)
        throw new Error("Operation challenge was not started");
      const challenge = await createdChallenge;
      if (!challenge) throw new Error("Operation challenge was not created");
      expect(challenge).not.toBeNull();
    } finally {
      if (gateHeld) await blocker.query("ROLLBACK");
      if (create) await Promise.allSettled([create]);
      blocker.release();
      observer.release();
      probe.release();
      await pool.end();
    }
  });

  it("admits proof issuance before it can lock the session, action or challenge", async () => {
    const fixture = await prepareStepUpAdmissionFixture("issue");
    const challenge = await createPendingActionChallenge({
      personId: fixture.person.id,
      sessionId: fixture.sessionId,
      pendingActionId: fixture.pendingActionId,
    });
    if (!challenge) throw new Error("Step-up challenge was not created");

    const pool = new Pool({
      connectionString: process.env.TASKDESK_DATABASE_URL,
      max: 3,
    });
    const blocker = await pool.connect();
    const observer = await pool.connect();
    const probe = await pool.connect();
    let verifierCalls = 0;
    const verifyAuthentication = async () => {
      verifierCalls += 1;
      return "password" as const;
    };
    let issue: ReturnType<typeof issuePendingActionToken> | undefined;
    let gateHeld = false;
    try {
      await blocker.query("BEGIN");
      gateHeld = true;
      const { rows } = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const blockerPid = requireRow(
        rows,
        "pending-action issue blocker PID query",
      ).pid;
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('taskdesk:pending-action-lifecycle'), hashtext('global'))",
      );
      issue = issuePendingActionToken(
        {
          id: challenge.id,
          nonce: challenge.nonce,
          personId: fixture.person.id,
          sessionId: fixture.sessionId,
          userId: fixture.user.id,
          pendingActionId: fixture.pendingActionId,
        },
        verifyAuthentication,
      );
      const admission = await waitForLifecycleBlocker(
        observer,
        blockerPid,
        () => hasIssuedPendingActionProof(observer, challenge.id),
      );
      expect(admission.state).toBe("waiting");
      expect(verifierCalls).toBe(0);

      // The held gate precedes A, S, P and C for this actual service call.
      await expectActionRowAvailable(probe, fixture.pendingActionId);
      await probe.query("BEGIN");
      try {
        const sessionResult = await probe.query(
          "SELECT id FROM session WHERE id = $1 FOR UPDATE NOWAIT",
          [fixture.sessionId],
        );
        expect(sessionResult.rowCount).toBe(1);
      } finally {
        await probe.query("ROLLBACK");
      }
      await probe.query("BEGIN");
      try {
        const challengeResult = await probe.query(
          "SELECT id FROM step_up_confirmation WHERE id = $1 FOR UPDATE NOWAIT",
          [challenge.id],
        );
        expect(challengeResult.rowCount).toBe(1);
      } finally {
        await probe.query("ROLLBACK");
      }

      await blocker.query("COMMIT");
      gateHeld = false;
      const proof = await issue;
      expect(proof).not.toBeNull();
      expect(verifierCalls).toBe(1);
    } finally {
      if (gateHeld) await blocker.query("ROLLBACK");
      if (issue) await Promise.allSettled([issue]);
      blocker.release();
      observer.release();
      probe.release();
      await pool.end();
    }
  });

  it("admits operation challenge and proof producers before their first row lock", async () => {
    const fixture = await prepareStepUpAdmissionFixture("operation");
    const note = "Verified the request with the account owner.";
    const pool = new Pool({
      connectionString: process.env.TASKDESK_DATABASE_URL,
      max: 3,
    });
    const blocker = await pool.connect();
    const observer = await pool.connect();
    const probe = await pool.connect();
    let create: ReturnType<typeof createMfaResetChallenge> | undefined;
    let issue: ReturnType<typeof issueMfaResetToken> | undefined;
    let gateHeld = false;
    try {
      await blocker.query("BEGIN");
      gateHeld = true;
      const { rows } = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const blockerPid = requireRow(
        rows,
        "operation challenge blocker PID query",
      ).pid;
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('taskdesk:pending-action-lifecycle'), hashtext('global'))",
      );
      create = createMfaResetChallenge({
        personId: fixture.person.id,
        sessionId: fixture.sessionId,
        userId: "step-up-admission-target",
        verificationNote: note,
      });
      const admission = await waitForLifecycleBlocker(
        observer,
        blockerPid,
        () => hasOperationChallenge(observer, fixture.sessionId),
      );
      if (admission.state !== "waiting") {
        throw new Error(
          "Operation challenge progressed while lifecycle gate was held",
        );
      }
      expect(admission.pid).not.toBe(blockerPid);
      expect(admission.query).toContain("pg_advisory_xact_lock");
      await probe.query("BEGIN");
      try {
        const result = await probe.query(
          "SELECT id FROM step_up_confirmation WHERE session_id = $1 FOR UPDATE NOWAIT",
          [fixture.sessionId],
        );
        expect(result.rowCount).toBe(0);
      } finally {
        await probe.query("ROLLBACK");
      }
      await probe.query("BEGIN");
      try {
        const sessionResult = await probe.query(
          "SELECT id FROM session WHERE id = $1 FOR UPDATE NOWAIT",
          [fixture.sessionId],
        );
        expect(sessionResult.rowCount).toBe(1);
      } finally {
        await probe.query("ROLLBACK");
      }
      await blocker.query("COMMIT");
      gateHeld = false;
      const challenge = await create;
      if (!challenge) throw new Error("Operation challenge was not created");

      await blocker.query("BEGIN");
      gateHeld = true;
      const issueBlocker = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const issueBlockerPid = requireRow(
        issueBlocker.rows,
        "operation issue blocker PID query",
      ).pid;
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('taskdesk:pending-action-lifecycle'), hashtext('global'))",
      );
      let operationVerifierCalls = 0;
      issue = issueMfaResetToken(
        {
          id: challenge.id,
          nonce: challenge.nonce,
          personId: fixture.person.id,
          sessionId: fixture.sessionId,
          userId: fixture.user.id,
          targetUserId: "step-up-admission-target",
          verificationNote: note,
        },
        async () => {
          operationVerifierCalls += 1;
          return "password" as const;
        },
      );
      const issueAdmission = await waitForLifecycleBlocker(
        observer,
        issueBlockerPid,
        async () => {
          const result = await observer.query(
            `SELECT id FROM step_up_confirmation
             WHERE id = $1 AND state = 'issued'`,
            [challenge.id],
          );
          return result.rowCount === 1;
        },
      );
      expect(issueAdmission.state).toBe("waiting");
      expect(operationVerifierCalls).toBe(0);
      await probe.query("BEGIN");
      try {
        const result = await probe.query(
          "SELECT id FROM session WHERE id = $1 FOR UPDATE NOWAIT",
          [fixture.sessionId],
        );
        expect(result.rowCount).toBe(1);
      } finally {
        await probe.query("ROLLBACK");
      }
      await blocker.query("COMMIT");
      gateHeld = false;
      const issuedProof = issue;
      if (!issuedProof) throw new Error("Operation proof was not started");
      expect(await issuedProof).not.toBeNull();
      expect(operationVerifierCalls).toBe(1);
    } finally {
      if (gateHeld) await blocker.query("ROLLBACK");
      if (create) await Promise.allSettled([create]);
      if (issue) await Promise.allSettled([issue]);
      blocker.release();
      observer.release();
      probe.release();
      await pool.end();
    }
  });

  it("expires both proof families after a recovered mint failure without a second verifier call", async () => {
    const fixture = await prepareStepUpAdmissionFixture("mint-failure");
    const pendingChallenge = await createPendingActionChallenge({
      personId: fixture.person.id,
      sessionId: fixture.sessionId,
      pendingActionId: fixture.pendingActionId,
    });
    const operationChallenge = await createMfaResetChallenge({
      personId: fixture.person.id,
      sessionId: fixture.sessionId,
      userId: "step-up-admission-mint-target",
      verificationNote: "Verify the one-attempt recovery action.",
    });
    if (!pendingChallenge || !operationChallenge) {
      throw new Error("Step-up challenge fixtures were not created");
    }

    let pendingVerifierCalls = 0;
    let operationVerifierCalls = 0;
    const pendingInput = {
      id: pendingChallenge.id,
      nonce: pendingChallenge.nonce,
      personId: fixture.person.id,
      sessionId: fixture.sessionId,
      userId: fixture.user.id,
      pendingActionId: fixture.pendingActionId,
    };
    const operationInput = {
      id: operationChallenge.id,
      nonce: operationChallenge.nonce,
      personId: fixture.person.id,
      sessionId: fixture.sessionId,
      userId: fixture.user.id,
      targetUserId: "step-up-admission-mint-target",
      verificationNote: "Verify the one-attempt recovery action.",
    };
    try {
      await db.execute(sql`
        CREATE FUNCTION fail_step_up_mint_for_attempt_test() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.state = 'issued' THEN
            RAISE EXCEPTION 'controlled step-up mint failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await db.execute(sql`
        CREATE TRIGGER fail_step_up_mint_for_attempt_test
        BEFORE UPDATE ON step_up_confirmation
        FOR EACH ROW EXECUTE FUNCTION fail_step_up_mint_for_attempt_test()
      `);
      await expect(
        issuePendingActionToken(pendingInput, async () => {
          pendingVerifierCalls += 1;
          return "password" as const;
        }),
      ).rejects.toThrow();
      await expect(
        issueMfaResetToken(operationInput, async () => {
          operationVerifierCalls += 1;
          return "password" as const;
        }),
      ).rejects.toThrow();

      const expired = await db.execute<{ id: string }>(sql`
        SELECT id FROM step_up_confirmation
        WHERE id IN (${pendingChallenge.id}, ${operationChallenge.id})
          AND state = 'challenge'
          AND challenge_expires_at <= clock_timestamp()
      `);
      expect(expired.rows.map((row) => row.id).sort()).toEqual(
        [pendingChallenge.id, operationChallenge.id].sort(),
      );

      expect(
        await issuePendingActionToken(pendingInput, async () => {
          pendingVerifierCalls += 1;
          return "password" as const;
        }),
      ).toBeNull();
      expect(
        await issueMfaResetToken(operationInput, async () => {
          operationVerifierCalls += 1;
          return "password" as const;
        }),
      ).toBeNull();
      expect(pendingVerifierCalls).toBe(1);
      expect(operationVerifierCalls).toBe(1);
    } finally {
      await db.execute(sql`
        DROP TRIGGER IF EXISTS fail_step_up_mint_for_attempt_test
        ON step_up_confirmation
      `);
      await db.execute(
        sql`DROP FUNCTION IF EXISTS fail_step_up_mint_for_attempt_test()`,
      );
    }
  });

  it("serializes a policy write before a concurrent role deletion", async () => {
    const pool = new Pool({
      connectionString: process.env.TASKDESK_DATABASE_URL,
      max: 2,
    });
    const writer = await pool.connect();
    const deleter = await pool.connect();
    try {
      await setupRole();
      const pidResult = await deleter.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      const deletePid = pidResult.rows[0]!.pid;
      await writer.query("begin");
      await writer.query("select id from role where id = $1 for key share", [
        "factor-policy-race-role",
      ]);
      await deleter.query("begin");
      let deleteFinished = false;
      let observedLockWait = false;
      const deletion = deleter
        .query("delete from role where id = $1", ["factor-policy-race-role"])
        .then(() => {
          deleteFinished = true;
          return { ok: true as const };
        })
        .catch((error: unknown) => {
          deleteFinished = true;
          return { ok: false as const, error };
        });
      for (let attempt = 0; attempt < 100 && !deleteFinished; attempt += 1) {
        const row = (
          await writer.query<{ waiting: boolean }>(
            "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
            [deletePid],
          )
        ).rows[0];
        if (row?.waiting) {
          observedLockWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observedLockWait).toBe(true);

      await writer.query(
        "select id from instance_setting where id = 'singleton' for update",
      );
      await writer.query(
        'update instance_setting set local_factor_policy = \'{"mode":"required_role","requiredRoleId":"factor-policy-race-role"}\'::jsonb where id = \'singleton\'',
      );
      await writer.query("commit");
      const deletionResult = await deletion;
      expect(deletionResult.ok).toBe(false);
      await deleter.query("rollback");
      const policyRow = (
        await writer.query<{
          policy: { mode: string; requiredRoleId: string | null };
        }>(
          "select local_factor_policy as policy from instance_setting where id = 'singleton'",
        )
      ).rows[0];
      const role = await writer.query("select id from role where id = $1", [
        "factor-policy-race-role",
      ]);
      expect(policyRow?.policy).toEqual({
        mode: "required_role",
        requiredRoleId: "factor-policy-race-role",
      });
      expect(role.rowCount).toBe(1);
    } finally {
      writer.release();
      deleter.release();
      await pool.end();
    }
  });

  it("serializes a role deletion before a concurrent policy write", async () => {
    const pool = new Pool({
      connectionString: process.env.TASKDESK_DATABASE_URL,
      max: 2,
    });
    const writer = await pool.connect();
    const deleter = await pool.connect();
    try {
      await setupRole();
      const pidResult = await deleter.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      const deletePid = pidResult.rows[0]!.pid;
      await db
        .update(schema.instanceSettingTable)
        .set({
          localFactorPolicy: {
            mode: "required_role",
            requiredRoleId: "factor-policy-race-role",
          },
        })
        .where(eq(schema.instanceSettingTable.id, "singleton"));
      await writer.query("begin");
      await writer.query(
        "select id from instance_setting where id = 'singleton' for update",
      );
      await deleter.query("begin");
      let deleteFinished = false;
      let observedLockWait = false;
      const deletion = deleter
        .query("delete from role where id = $1", ["factor-policy-race-role"])
        .then(() => {
          deleteFinished = true;
          return { ok: true as const };
        })
        .catch((error: unknown) => {
          deleteFinished = true;
          return { ok: false as const, error };
        });
      for (let attempt = 0; attempt < 100 && !deleteFinished; attempt += 1) {
        const row = (
          await writer.query<{ waiting: boolean }>(
            "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
            [deletePid],
          )
        ).rows[0];
        if (row?.waiting) {
          observedLockWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observedLockWait).toBe(true);

      await writer.query(
        'update instance_setting set local_factor_policy = \'{"mode":"optional","requiredRoleId":null}\'::jsonb where id = \'singleton\'',
      );
      await writer.query("commit");
      const deletionResult = await deletion;
      expect(deletionResult.ok).toBe(true);
      await deleter.query("commit");
      const policyRow = (
        await writer.query<{
          policy: { mode: string; requiredRoleId: string | null };
        }>(
          "select local_factor_policy as policy from instance_setting where id = 'singleton'",
        )
      ).rows[0];
      const role = await writer.query("select id from role where id = $1", [
        "factor-policy-race-role",
      ]);
      expect(policyRow?.policy).toEqual({
        mode: "optional",
        requiredRoleId: null,
      });
      expect(role.rowCount).toBe(0);
    } finally {
      writer.release();
      deleter.release();
      await pool.end();
    }
  });
});
