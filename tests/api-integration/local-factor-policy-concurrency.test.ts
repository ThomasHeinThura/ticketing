import { createRequire } from "node:module";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfiguredAgentOrigin } from "../../apps/api/src/auth";
import * as localFactorService from "../../apps/api/src/auth/local-factor-service";
import {
  createMfaResetChallenge,
  createPendingActionChallenge,
  issueMfaResetToken,
  issuePendingActionToken,
} from "../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  ensureInternalOrganisation,
  ensureStaffPersonForUser,
} from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";
import { createCredentialBoundPendingAction } from "./helpers/pending-action";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
let policyAdmissionSignInAddress = 10;

function nextPolicyAdmissionSignInIp() {
  policyAdmissionSignInAddress += 1;
  return `198.51.100.${policyAdmissionSignInAddress}`;
}

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
});

type PolicyAdmissionAdmin = {
  id: string;
  email: string;
  password: string;
  cookie: string;
};

async function createPolicyAdmissionAdmin(
  app: ReturnType<typeof createApp>["app"],
  id: string,
): Promise<PolicyAdmissionAdmin> {
  const email = `${id}@example.test`;
  const password = `${id}-password`;
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name: id, email, role: "admin" })
    .returning({ id: schema.userTable.id, email: schema.userTable.email });
  if (!user) throw new Error("policy admission admin was not created");
  await ensureStaffPersonForUser(user.id);
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(password, 4),
  });
  const signIn = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextPolicyAdmissionSignInIp(),
    },
    body: JSON.stringify({ email, password }),
  });
  expect(signIn.status).toBe(200);
  const cookie = signIn.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!cookie) throw new Error("policy admission session cookie is missing");
  return { id: user.id, email: user.email, password, cookie };
}

async function preparePolicyAdmissionActors(
  app: ReturnType<typeof createApp>["app"],
  label: string,
) {
  const actor = await createPolicyAdmissionAdmin(
    app,
    `factor-policy-issuer-${label}`,
  );
  const writer = await createPolicyAdmissionAdmin(
    app,
    `factor-policy-writer-${label}`,
  );
  const [actorPerson] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, actor.id));
  if (!actorPerson)
    throw new Error("policy admission actor identity is missing");
  const organisation = await ensureInternalOrganisation();
  const roleId = `factor-policy-required-${label}`;
  await db.insert(schema.roleTable).values({
    id: roleId,
    scope: "organisation",
    workspaceId: null,
    key: `factor-policy-${label}`,
    name: `Factor policy ${label}`,
    rank: 10,
    capabilities: [],
  });
  await db.insert(schema.membershipTable).values({
    personId: actorPerson.id,
    scope: "organisation",
    scopeId: organisation.id,
    roleId,
    seesAll: false,
  });
  return { actor, writer, roleId };
}

function deferred<T>() {
  let resolve = (_value: T | PromiseLike<T>) => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

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

async function waitForPolicyWriterAtTestBarrier(
  observer: import("pg").PoolClient,
  barrierPid: number,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ pid: number; query: string }>(
      `SELECT pid, query
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND $1 = ANY(pg_blocking_pids(pid))`,
      [barrierPid],
    );
    const writer = result.rows.find((row) =>
      row.query.toLowerCase().includes("instance_setting"),
    );
    if (writer) return writer;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Policy PATCH did not reach its controlled database barrier");
}

async function waitForPidBlockedByPid(
  observer: import("pg").PoolClient,
  blockedPid: number,
  blockerPid: number,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ blocked: boolean }>(
      `SELECT $2 = ANY(pg_blocking_pids(pid)) AS blocked
       FROM pg_stat_activity
       WHERE datname = current_database() AND pid = $1`,
      [blockedPid, blockerPid],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `PostgreSQL backend ${blockedPid} did not wait on ${blockerPid}`,
  );
}

async function policyModeIs(observer: import("pg").PoolClient, mode: string) {
  const result = await observer.query<{ policy: { mode: string } }>(
    "SELECT local_factor_policy AS policy FROM instance_setting WHERE id = 'singleton'",
  );
  return result.rows[0]?.policy.mode === mode;
}

async function hasChallengeState(
  observer: import("pg").PoolClient,
  challengeId: string,
  state: string,
) {
  const result = await observer.query(
    "SELECT id FROM step_up_confirmation WHERE id = $1 AND state = $2",
    [challengeId, state],
  );
  return result.rowCount === 1;
}

type PolicyRaceCase = {
  kind: "pending_action" | "operation";
  actor: PolicyAdmissionAdmin;
  writer: PolicyAdmissionAdmin;
  target: { id: string; email: string };
  requiredRoleId: string;
  challengeId: string;
  nonce: string;
  pendingActionId?: string;
  verificationNote: string;
};

async function preparePolicyRaceCase(
  app: ReturnType<typeof createApp>["app"],
  label: string,
  kind: PolicyRaceCase["kind"],
): Promise<PolicyRaceCase> {
  const { actor, writer, roleId } = await preparePolicyAdmissionActors(
    app,
    label,
  );
  const targetId = `factor-policy-target-${label}`;
  const [target] = await db
    .insert(schema.userTable)
    .values({
      id: targetId,
      name: targetId,
      email: `${targetId}@example.test`,
      role: "user",
      twoFactorEnabled: true,
    })
    .returning({ id: schema.userTable.id, email: schema.userTable.email });
  if (!target) throw new Error("policy race target was not created");
  await ensureStaffPersonForUser(target.id);

  let pendingActionId: string | undefined;
  if (kind === "pending_action") {
    const requested = await csrfRequest(
      app,
      `/api/instance/users/${target.id}/deactivate`,
      {
        method: "POST",
        headers: { cookie: actor.cookie, "content-type": "application/json" },
        body: "{}",
      },
      actor.cookie,
    );
    expect(requested.status).toBe(202);
    const requestBody = (await requested.json()) as {
      pendingActionId: string;
    };
    pendingActionId = requestBody.pendingActionId;
  }
  const verificationNote = "Verified the account recovery request.";
  let challengeInput:
    | { kind: "pending_action"; pendingActionId: string }
    | {
        kind: "operation";
        operation: "mfa_reset";
        userId: string;
        verificationNote: string;
      };
  if (kind === "pending_action") {
    if (!pendingActionId) {
      throw new Error("policy race pending action was not created");
    }
    challengeInput = { kind, pendingActionId };
  } else {
    challengeInput = {
      kind,
      operation: "mfa_reset",
      userId: target.id,
      verificationNote,
    };
  }
  const challengeRequest = await csrfRequest(
    app,
    "/api/me/step-up/challenges",
    {
      method: "POST",
      headers: { cookie: actor.cookie, "content-type": "application/json" },
      body: JSON.stringify(challengeInput),
    },
    actor.cookie,
  );
  expect(challengeRequest.status).toBe(200);
  const challenge = (await challengeRequest.json()) as {
    challengeId: string;
    nonce: string;
  };
  return {
    kind,
    actor,
    writer,
    target,
    requiredRoleId: roleId,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    ...(pendingActionId ? { pendingActionId } : {}),
    verificationNote,
  };
}

function policyRaceProofBody(race: PolicyRaceCase) {
  if (race.kind === "pending_action") {
    if (!race.pendingActionId) {
      throw new Error("policy race pending action is missing");
    }
    return {
      kind: race.kind,
      pendingActionId: race.pendingActionId,
      challengeId: race.challengeId,
      nonce: race.nonce,
      method: "password",
      password: race.actor.password,
    };
  }
  return {
    kind: race.kind,
    operation: "mfa_reset",
    userId: race.target.id,
    verificationNote: race.verificationNote,
    challengeId: race.challengeId,
    nonce: race.nonce,
    method: "password",
    password: race.actor.password,
  };
}

async function issueApprovalCsrfContext(
  app: ReturnType<typeof createApp>["app"],
  sessionCookie: string,
) {
  const origin = getConfiguredAgentOrigin();
  const response = await app.request("/api/me/csrf-token", {
    headers: { cookie: sessionCookie, origin },
  });
  expect(response.status).toBe(200);
  const issued = (await response.json()) as { token: string };
  const cookieName =
    new URL(origin).protocol === "https:" ? "__Host-tdk_csrf" : "tdk_csrf_dev";
  const csrfCookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${cookieName}=`))
    ?.split(";", 1)[0];
  if (!csrfCookie) throw new Error("CSRF issuer cookie was not set");
  return {
    origin,
    token: issued.token,
    cookie: `${sessionCookie}; ${csrfCookie}`,
  };
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

  it.each(["pending_action", "operation"] as const)(
    "serializes a %s proof behind an actual local-factor policy PATCH",
    async (kind) => {
      const { app } = createApp();
      const race = await preparePolicyRaceCase(app, `issuer-${kind}`, kind);
      const approvalCsrf =
        race.kind === "pending_action"
          ? await issueApprovalCsrfContext(app, race.actor.cookie)
          : undefined;
      const pool = new Pool({
        connectionString: process.env.TASKDESK_DATABASE_URL,
        max: 3,
      });
      const finalFactorLoaded = deferred<{
        pid: number;
        required: boolean;
        enabled: boolean;
      }>();
      const releaseFinalFactor = deferred<void>();
      const originalLoadLocalFactorState =
        localFactorService.loadLocalFactorState;
      let enlistedFactorReads = 0;
      const loadFactorSpy = vi
        .spyOn(localFactorService, "loadLocalFactorState")
        .mockImplementation(async (userId, executor) => {
          const factor = await originalLoadLocalFactorState(userId, executor);
          if (userId === race.actor.id && executor !== undefined) {
            enlistedFactorReads += 1;
            if (enlistedFactorReads === 2) {
              const backend = await executor.execute<{ pid: number }>(
                sql`SELECT pg_backend_pid() AS pid`,
              );
              finalFactorLoaded.resolve({
                pid: backend.rows[0]?.pid ?? -1,
                required: factor.required,
                enabled: factor.enabled,
              });
              await releaseFinalFactor.promise;
            }
          }
          return factor;
        });
      let proofRequest: Promise<Response> | undefined;
      let policyRequest: Promise<Response> | undefined;
      let observer: import("pg").PoolClient | undefined;
      let probe: import("pg").PoolClient | undefined;
      try {
        const observerClient = await pool.connect();
        observer = observerClient;
        const probeClient = await pool.connect();
        probe = probeClient;
        proofRequest = csrfRequest(
          app,
          "/api/me/step-up",
          {
            method: "POST",
            headers: {
              cookie: race.actor.cookie,
              "content-type": "application/json",
            },
            body: JSON.stringify(policyRaceProofBody(race)),
          },
          race.actor.cookie,
        );
        let finalFactorDeadline: ReturnType<typeof setTimeout> | undefined;
        let finalFactor: {
          pid: number;
          required: boolean;
          enabled: boolean;
        };
        try {
          const checkpoint = await Promise.race([
            finalFactorLoaded.promise.then((factor) => ({
              kind: "factor" as const,
              factor,
            })),
            proofRequest.then((response) => ({
              kind: "response" as const,
              status: response.status,
            })),
            new Promise<{ kind: "deadline" }>((resolve) => {
              finalFactorDeadline = setTimeout(
                () => resolve({ kind: "deadline" }),
                15_000,
              );
            }),
          ]);
          if (checkpoint.kind === "response") {
            throw new Error(
              `Step-up request returned ${checkpoint.status} before final factor revalidation`,
            );
          }
          if (checkpoint.kind === "deadline") {
            throw new Error(
              "Timed out waiting for the delegated final-factor checkpoint",
            );
          }
          finalFactor = checkpoint.factor;
        } finally {
          if (finalFactorDeadline !== undefined) {
            clearTimeout(finalFactorDeadline);
          }
        }
        expect(finalFactor.pid).toBeGreaterThan(0);
        expect(finalFactor).toMatchObject({ required: false, enabled: false });

        policyRequest = csrfRequest(
          app,
          "/api/instance/local-factor-policy",
          {
            method: "PATCH",
            headers: {
              cookie: race.writer.cookie,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              mode: "required_role",
              requiredRoleId: race.requiredRoleId,
            }),
          },
          race.writer.cookie,
        );
        const admission = await waitForLifecycleBlocker(
          observerClient,
          finalFactor.pid,
          () => policyModeIs(observerClient, "required_role"),
        );
        if (admission.state === "waiting") {
          expect(admission.query).toContain("pg_advisory_xact_lock");
          await probeClient.query("BEGIN");
          try {
            const role = await probeClient.query(
              "SELECT id FROM role WHERE id = $1 FOR UPDATE NOWAIT",
              [race.requiredRoleId],
            );
            const singleton = await probeClient.query(
              "SELECT id FROM instance_setting WHERE id = 'singleton' FOR UPDATE NOWAIT",
            );
            expect(role.rowCount).toBe(1);
            expect(singleton.rowCount).toBe(1);
          } finally {
            await probeClient.query("ROLLBACK");
          }
        }

        releaseFinalFactor.resolve();
        if (!proofRequest || !policyRequest) {
          throw new Error("policy issuer/writer requests were not started");
        }
        const [proofResponse, policyResponse] = await Promise.all([
          proofRequest,
          policyRequest,
        ]);
        const proofBody =
          proofResponse.status === 200
            ? ((await proofResponse.json()) as { token?: unknown })
            : undefined;
        const token =
          typeof proofBody?.token === "string" ? proofBody.token : undefined;
        const [issued] = await db
          .select({
            state: schema.stepUpConfirmationTable.state,
            authMethod: schema.stepUpConfirmationTable.authMethod,
          })
          .from(schema.stepUpConfirmationTable)
          .where(eq(schema.stepUpConfirmationTable.id, race.challengeId));
        const [storedPolicy] = await db
          .select({ policy: schema.instanceSettingTable.localFactorPolicy })
          .from(schema.instanceSettingTable)
          .where(eq(schema.instanceSettingTable.id, "singleton"));

        let approvalStatus: number | null = null;
        let approvalMessage: string | null = null;
        let pendingState: string | null = null;
        let targetActive: boolean | null = null;
        if (race.kind === "pending_action") {
          if (!approvalCsrf || !race.pendingActionId || !token) {
            throw new Error("pending-action policy race fixture is incomplete");
          }
          const approval = await app.request(
            `/api/me/pending-actions/${race.pendingActionId}/approve`,
            {
              method: "POST",
              headers: {
                cookie: approvalCsrf.cookie,
                origin: approvalCsrf.origin,
                "x-taskdesk-csrf": approvalCsrf.token,
                "x-taskdesk-step-up-token": token,
                "content-type": "application/json",
              },
              body: JSON.stringify({ typedName: race.target.email }),
            },
          );
          approvalStatus = approval.status;
          approvalMessage = await approval.text();
          const [action] = await db
            .select({ state: schema.pendingActionTable.state })
            .from(schema.pendingActionTable)
            .where(eq(schema.pendingActionTable.id, race.pendingActionId));
          pendingState = action?.state ?? null;
          const [person] = await db
            .select({ active: schema.personTable.active })
            .from(schema.personTable)
            .where(eq(schema.personTable.userId, race.target.id));
          targetActive = person?.active ?? null;
        }

        expect({
          admissionState: admission.state,
          policyStatus: policyResponse.status,
          factorBeforePatch: {
            required: finalFactor.required,
            enabled: finalFactor.enabled,
          },
          proofStatus: proofResponse.status,
          proofTokenPresent: token !== undefined,
          challengeState: issued?.state ?? null,
          authMethod: issued?.authMethod ?? null,
          policyMode: storedPolicy?.policy.mode ?? null,
          approvalStatus,
          approvalMessage,
          pendingState,
          targetActive,
        }).toEqual({
          admissionState: "waiting",
          policyStatus: 200,
          factorBeforePatch: { required: false, enabled: false },
          proofStatus: 200,
          proofTokenPresent: true,
          challengeState: "issued",
          authMethod: "password",
          policyMode: "required_role",
          approvalStatus: race.kind === "pending_action" ? 403 : null,
          approvalMessage:
            race.kind === "pending_action" ? "mfa_enrollment_required" : null,
          pendingState: race.kind === "pending_action" ? "pending" : null,
          targetActive: race.kind === "pending_action" ? true : null,
        });
      } finally {
        releaseFinalFactor.resolve();
        const pending = [proofRequest, policyRequest].filter(
          (request): request is Promise<Response> => request !== undefined,
        );
        await Promise.allSettled(pending);
        loadFactorSpy.mockRestore();
        observer?.release();
        probe?.release();
        await pool.end();
      }
    },
  );

  // The issuer waits behind the writer, then its verifier reads the committed
  // required policy. Null verification expires the challenge but keeps its state.
  it("expires a policy-first challenge after its verifier reads the required policy", async () => {
    const { app } = createApp();
    const race = await preparePolicyRaceCase(
      app,
      "policy-first",
      "pending_action",
    );
    const proofCsrf = await issueApprovalCsrfContext(app, race.actor.cookie);
    if (!race.pendingActionId) {
      throw new Error("policy-first pending action was not created");
    }
    const [initialChallenge] = await db
      .select({
        state: schema.stepUpConfirmationTable.state,
        live: sql<boolean>`
            ${schema.stepUpConfirmationTable.challengeExpiresAt}
            > clock_timestamp()
          `,
      })
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.id, race.challengeId));
    expect(initialChallenge).toEqual({ state: "challenge", live: true });
    const pool = new Pool({
      connectionString: process.env.TASKDESK_DATABASE_URL,
      max: 3,
    });
    const barrierKey = "taskdesk:test:local-factor-policy-writer-barrier";
    let barrierHeld = false;
    let functionInstalled = false;
    let triggerInstalled = false;
    let policyRequest: Promise<Response> | undefined;
    let proofRequest: Promise<Response> | undefined;
    let barrier: import("pg").PoolClient | undefined;
    let observer: import("pg").PoolClient | undefined;
    const originalLoadLocalFactorState =
      localFactorService.loadLocalFactorState;
    let verifierFactor:
      | {
          policyMode: string;
          required: boolean;
          enabled: boolean;
        }
      | undefined;
    const loadFactorSpy = vi
      .spyOn(localFactorService, "loadLocalFactorState")
      .mockImplementation(async (userId, executor) => {
        const factor = await originalLoadLocalFactorState(userId, executor);
        if (userId === race.actor.id && executor !== undefined) {
          verifierFactor = {
            policyMode: factor.policy.mode,
            required: factor.required,
            enabled: factor.enabled,
          };
        }
        return factor;
      });
    try {
      const barrierClient = await pool.connect();
      barrier = barrierClient;
      const observerClient = await pool.connect();
      observer = observerClient;
      await db.execute(
        sql`DROP TRIGGER IF EXISTS pause_policy_writer_for_test ON instance_setting`,
      );
      await db.execute(
        sql`DROP FUNCTION IF EXISTS pause_policy_writer_for_test()`,
      );
      await db.execute(sql`
        CREATE FUNCTION pause_policy_writer_for_test() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.id = 'singleton'
            AND NEW.local_factor_policy IS DISTINCT FROM OLD.local_factor_policy THEN
            PERFORM pg_advisory_xact_lock(
              hashtext('taskdesk:test:local-factor-policy-writer-barrier'),
              hashtext('policy-first')
            );
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      functionInstalled = true;
      await db.execute(sql`
        CREATE TRIGGER pause_policy_writer_for_test
        BEFORE UPDATE OF local_factor_policy ON instance_setting
        FOR EACH ROW EXECUTE FUNCTION pause_policy_writer_for_test()
      `);
      triggerInstalled = true;

      await barrierClient.query("BEGIN");
      barrierHeld = true;
      const barrierPidResult = await barrierClient.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const barrierPid = requireRow(
        barrierPidResult.rows,
        "policy barrier PID query",
      ).pid;
      await barrierClient.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext('policy-first'))",
        [barrierKey],
      );

      policyRequest = csrfRequest(
        app,
        "/api/instance/local-factor-policy",
        {
          method: "PATCH",
          headers: {
            cookie: race.writer.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mode: "required_role",
            requiredRoleId: race.requiredRoleId,
          }),
        },
        race.writer.cookie,
      );
      const writer = await waitForPolicyWriterAtTestBarrier(
        observerClient,
        barrierPid,
      );
      expect(writer.query.toLowerCase()).toContain("instance_setting");

      proofRequest = Promise.resolve(
        app.request("/api/me/step-up", {
          method: "POST",
          headers: {
            cookie: proofCsrf.cookie,
            origin: proofCsrf.origin,
            "x-taskdesk-csrf": proofCsrf.token,
            "content-type": "application/json",
          },
          body: JSON.stringify(policyRaceProofBody(race)),
        }),
      );
      const admission = await waitForLifecycleBlocker(
        observerClient,
        writer.pid,
        () => hasChallengeState(observerClient, race.challengeId, "issued"),
      );

      await barrierClient.query("COMMIT");
      barrierHeld = false;
      if (!policyRequest || !proofRequest) {
        throw new Error("policy-first writer/issuer requests were not started");
      }
      const [policyResponse, proofResponse] = await Promise.all([
        policyRequest,
        proofRequest,
      ]);
      const proofMessage = await proofResponse.text();
      const [challenge] = await db
        .select({
          state: schema.stepUpConfirmationTable.state,
          authMethod: schema.stepUpConfirmationTable.authMethod,
          expired: sql<boolean>`
              ${schema.stepUpConfirmationTable.challengeExpiresAt}
              <= clock_timestamp()
            `,
        })
        .from(schema.stepUpConfirmationTable)
        .where(eq(schema.stepUpConfirmationTable.id, race.challengeId));
      const [action] = await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, race.pendingActionId));
      const [person] = await db
        .select({ active: schema.personTable.active })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, race.target.id));
      const [storedPolicy] = await db
        .select({ policy: schema.instanceSettingTable.localFactorPolicy })
        .from(schema.instanceSettingTable)
        .where(eq(schema.instanceSettingTable.id, "singleton"));

      expect({
        writerStatus: policyResponse.status,
        policyMode: storedPolicy?.policy.mode ?? null,
        issuerWait: admission.state,
        proofStatus: proofResponse.status,
        proofMessage,
        verifierFactor: verifierFactor ?? null,
        challengeState: challenge?.state ?? null,
        challengeExpired: challenge?.expired ?? null,
        authMethod: challenge?.authMethod ?? null,
        pendingState: action?.state ?? null,
        targetActive: person?.active ?? null,
      }).toEqual({
        writerStatus: 200,
        policyMode: "required_role",
        issuerWait: "waiting",
        proofStatus: 403,
        proofMessage: "step_up_unavailable",
        verifierFactor: {
          policyMode: "required_role",
          required: true,
          enabled: false,
        },
        challengeState: "challenge",
        challengeExpired: true,
        authMethod: null,
        pendingState: "pending",
        targetActive: true,
      });
    } finally {
      if (barrierHeld && barrier) await barrier.query("ROLLBACK");
      const pending = [policyRequest, proofRequest].filter(
        (request): request is Promise<Response> => request !== undefined,
      );
      await Promise.allSettled(pending);
      if (triggerInstalled) {
        await db.execute(
          sql`DROP TRIGGER IF EXISTS pause_policy_writer_for_test ON instance_setting`,
        );
      }
      if (functionInstalled) {
        await db.execute(
          sql`DROP FUNCTION IF EXISTS pause_policy_writer_for_test()`,
        );
      }
      loadFactorSpy.mockRestore();
      barrier?.release();
      observer?.release();
      await pool.end();
    }
  });

  it("keeps the actual policy PATCH role lock before its singleton update", async () => {
    const { app } = createApp();
    const { writer, roleId } = await preparePolicyAdmissionActors(
      app,
      "role-before-singleton",
    );
    const pool = new Pool({
      connectionString: process.env.TASKDESK_DATABASE_URL,
      max: 4,
    });
    let singletonLockHeld = false;
    let deleterTransaction = false;
    let policyRequest: Promise<Response> | undefined;
    let deletion:
      | Promise<
          | { ok: true }
          | {
              ok: false;
              code: string | undefined;
              constraint: string | undefined;
            }
        >
      | undefined;
    let singletonBlocker: import("pg").PoolClient | undefined;
    let deleter: import("pg").PoolClient | undefined;
    let observer: import("pg").PoolClient | undefined;
    try {
      const singletonBlockerClient = await pool.connect();
      singletonBlocker = singletonBlockerClient;
      const deleterClient = await pool.connect();
      deleter = deleterClient;
      const observerClient = await pool.connect();
      observer = observerClient;
      await singletonBlockerClient.query("BEGIN");
      singletonLockHeld = true;
      const blockerPidResult = await singletonBlockerClient.query<{
        pid: number;
      }>("SELECT pg_backend_pid() AS pid");
      const blockerPid = requireRow(
        blockerPidResult.rows,
        "singleton blocker PID query",
      ).pid;
      await singletonBlockerClient.query(
        "SELECT id FROM instance_setting WHERE id = 'singleton' FOR UPDATE",
      );

      policyRequest = csrfRequest(
        app,
        "/api/instance/local-factor-policy",
        {
          method: "PATCH",
          headers: {
            cookie: writer.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mode: "required_role",
            requiredRoleId: roleId,
          }),
        },
        writer.cookie,
      );
      const policyWaiter = await waitForPolicyWriterAtTestBarrier(
        observerClient,
        blockerPid,
      );
      expect(policyWaiter.query.toLowerCase()).toContain("instance_setting");

      await deleterClient.query("BEGIN");
      deleterTransaction = true;
      const deletePidResult = await deleterClient.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const deletePid = requireRow(
        deletePidResult.rows,
        "role delete PID query",
      ).pid;
      deletion = deleterClient
        .query("DELETE FROM role WHERE id = $1", [roleId])
        .then(() => ({ ok: true as const }))
        .catch((error: unknown) => ({
          ok: false as const,
          code:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : undefined,
          constraint:
            error && typeof error === "object" && "constraint" in error
              ? String(error.constraint)
              : undefined,
        }));
      await waitForPidBlockedByPid(observerClient, deletePid, policyWaiter.pid);

      await singletonBlockerClient.query("COMMIT");
      singletonLockHeld = false;
      if (!policyRequest || !deletion) {
        throw new Error("policy writer/role delete requests were not started");
      }
      const policyResponse = await policyRequest;
      const deletionResult = await deletion;
      await deleterClient.query("ROLLBACK");
      deleterTransaction = false;
      const [storedPolicy] = await db
        .select({ policy: schema.instanceSettingTable.localFactorPolicy })
        .from(schema.instanceSettingTable)
        .where(eq(schema.instanceSettingTable.id, "singleton"));
      const storedRole = await db
        .select({ id: schema.roleTable.id })
        .from(schema.roleTable)
        .where(eq(schema.roleTable.id, roleId));

      expect({
        policyStatus: policyResponse.status,
        policy: storedPolicy?.policy ?? null,
        roleDelete: deletionResult,
        roleCount: storedRole.length,
      }).toEqual({
        policyStatus: 200,
        policy: { mode: "required_role", requiredRoleId: roleId },
        roleDelete: {
          ok: false,
          code: "23503",
          constraint: "role_required_by_local_factor_policy",
        },
        roleCount: 1,
      });
    } finally {
      if (singletonLockHeld && singletonBlocker) {
        await singletonBlocker.query("ROLLBACK");
      }
      if (deleterTransaction && deleter) await deleter.query("ROLLBACK");
      const pending: Array<Promise<unknown> | undefined> = [
        policyRequest,
        deletion,
      ];
      await Promise.allSettled(
        pending.filter(
          (request): request is Promise<unknown> => request !== undefined,
        ),
      );
      singletonBlocker?.release();
      deleter?.release();
      observer?.release();
      await pool.end();
    }
  });
});
