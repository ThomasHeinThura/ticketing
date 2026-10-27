/**
 * PA-15 / P0R1-02: step-up challenge creation and failed credential proofs are budgeted per
 * session, person and client address across all pending actions and operations. Cancelling and
 * re-requesting an action (a new pending action with a fresh per-action budget) cannot reset it.
 */
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkStepUpProofBudget,
  clearStepUpProofFailures,
  consumeStepUpChallengeBudget,
  recordStepUpProofFailure,
  reserveStepUpProofAttempt,
  STEP_UP_BUDGET_LIMITS,
  settleStepUpProofAttempt,
} from "../../apps/api/src/auth/step-up-limits";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};

vi.mock("@taskdesk/email", () => ({
  isSmtpConfigured: () => true,
  sendNotificationEmail: vi.fn(async () => ({ success: true })),
}));

async function adminSession(id: string) {
  const now = new Date();
  const [admin] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: id,
      email: `${id}@example.test`,
      role: "admin",
    })
    .returning();
  if (!admin) throw new Error("admin fixture");
  await ensureStaffPersonForUser(admin.id);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, admin.id));
  mockAuthenticatedSession(admin);
  await db.insert(schema.sessionTable).values({
    id: `session-${admin.id}`,
    token: `token-${admin.id}`,
    userId: admin.id,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 600_000),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: admin.id,
    providerId: "credential",
    userId: admin.id,
    password: await bcrypt.hash("the-correct-password", 4),
  });
  return {
    admin,
    personId: person?.id ?? "",
    sessionId: `session-${admin.id}`,
  };
}

const post = (
  app: ReturnType<typeof createApp>["app"],
  path: string,
  body: unknown,
) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("API integration: step-up global attempt budgets (PA-15)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  });

  it("a cancel and re-request loop on fresh pending actions is throttled per session", async () => {
    const { admin } = await adminSession("p0-loop-admin");
    const { app } = createApp();
    const limit = STEP_UP_BUDGET_LIMITS.step_up_challenge.session;

    // Each request names a different pending action, so no per-action budget ever applies.
    for (let i = 0; i < limit; i += 1) {
      const res = await post(app, "/api/me/step-up/challenges", {
        kind: "pending_action",
        pendingActionId: `fresh-action-${i}`,
      });
      expect(res.status, `request ${i}`).not.toBe(429);
    }
    const limited = await post(app, "/api/me/step-up/challenges", {
      kind: "pending_action",
      pendingActionId: "fresh-action-last",
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      message: "step_up_attempt_limit",
      limit,
      windowMinutes: 15,
    });
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(admin.id).toBeTruthy();
  });

  it("a spent person budget refuses another session of the same person, and the address budget is shared", async () => {
    const a = await adminSession("p0-budget-a");
    const person = STEP_UP_BUDGET_LIMITS.step_up_challenge.person;
    for (let i = 0; i < person; i += 1)
      expect(
        (
          await consumeStepUpChallengeBudget({
            personId: a.personId,
            sessionId: `rotating-session-${i}`,
            clientIp: `203.0.113.${i + 1}`,
          })
        ).allowed,
      ).toBe(true);
    const next = await consumeStepUpChallengeBudget({
      personId: a.personId,
      sessionId: "yet-another-session",
      clientIp: "198.51.100.200",
    });
    expect(next).toMatchObject({ allowed: false, limit: person });

    const ip = STEP_UP_BUDGET_LIMITS.step_up_challenge.ip;
    let refused = 0;
    for (let i = 0; i < ip + 1; i += 1) {
      const decision = await consumeStepUpChallengeBudget({
        personId: `p-${i}`,
        sessionId: `s-${i}`,
        clientIp: "192.0.2.77",
      });
      if (!decision.allowed) refused += 1;
    }
    expect(refused).toBe(1);
  });

  it("failed proofs are budgeted across challenges; a correct password is refused once spent and mints nothing", async () => {
    const { personId, sessionId } = await adminSession("p0-proof-admin");
    const { app } = createApp();
    const subject = { personId, sessionId, clientIp: null };
    const limit = STEP_UP_BUDGET_LIMITS.step_up_proof_failure.session;
    for (let i = 0; i < limit; i += 1) await recordStepUpProofFailure(subject);
    expect((await checkStepUpProofBudget(subject)).allowed).toBe(false);

    const challenge = await post(app, "/api/me/step-up/challenges", {
      kind: "operation",
      operation: "metrics_token_rotate",
      version: 1,
    });
    expect(challenge.status).toBe(200);
    const { challengeId, nonce } = (await challenge.json()) as {
      challengeId: string;
      nonce: string;
    };
    const proof = await post(app, "/api/me/step-up", {
      kind: "operation",
      operation: "metrics_token_rotate",
      version: 1,
      challengeId,
      nonce,
      method: "password",
      password: "the-correct-password",
    });
    expect(proof.status).toBe(429);
    expect(await proof.text()).toBe("step_up_attempt_limit");
    const issued = await db
      .select({ state: schema.stepUpConfirmationTable.state })
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.id, challengeId));
    expect(issued).toEqual([{ state: "challenge" }]);
  });

  it("wrong passwords count, and a legitimate success clears the person and session counters", async () => {
    const { personId, sessionId } = await adminSession("p0-success-admin");
    const { app } = createApp();
    const request = async (password: string) => {
      const challenge = await post(app, "/api/me/step-up/challenges", {
        kind: "operation",
        operation: "metrics_token_rotate",
        version: 1,
      });
      const { challengeId, nonce } = (await challenge.json()) as {
        challengeId: string;
        nonce: string;
      };
      return post(app, "/api/me/step-up", {
        kind: "operation",
        operation: "metrics_token_rotate",
        version: 1,
        challengeId,
        nonce,
        method: "password",
        password,
      });
    };

    for (let i = 0; i < 3; i += 1)
      expect((await request("wrong-password")).status).toBe(403);
    const failures = await db
      .select()
      .from(schema.requestRateLimitCounterTable);
    // In-process requests have no resolvable client address, so only the session and person
    // budgets count; an unknown address never shares one bucket across callers.
    expect(
      failures.filter((r) => r.bucket === "step_up_proof_failure"),
    ).toHaveLength(2);

    const ok = await request("the-correct-password");
    expect(ok.status, await ok.clone().text()).toBe(200);
    const remaining = await db
      .select()
      .from(schema.requestRateLimitCounterTable);
    // A success clears the person and session counters (an address counter would survive).
    expect(
      remaining.filter((r) => r.bucket === "step_up_proof_failure"),
    ).toHaveLength(0);
    expect(
      (await checkStepUpProofBudget({ personId, sessionId, clientIp: null }))
        .allowed,
    ).toBe(true);
    await clearStepUpProofFailures({ personId, sessionId });
  });

  it("P0R2-01: concurrent reservations never take more failed-proof slots than the budget", async () => {
    const subject = {
      personId: "p0r2-person",
      sessionId: "p0r2-session",
      clientIp: "203.0.113.50",
    };
    const limits = STEP_UP_BUDGET_LIMITS.step_up_proof_failure;
    const reservations = await Promise.all(
      Array.from({ length: limits.session + 12 }, () =>
        reserveStepUpProofAttempt(subject),
      ),
    );
    const accepted = reservations.filter((r) => r.allowed);
    expect(accepted).toHaveLength(limits.session);
    expect(
      reservations.filter((r) => !r.allowed).every((r) => r.held.length === 0),
    ).toBe(true);
    const counts = (
      await db
        .select()
        .from(schema.requestRateLimitCounterTable)
        .where(
          eq(
            schema.requestRateLimitCounterTable.bucket,
            "step_up_proof_failure",
          ),
        )
    )
      .map((r) => r.count)
      .sort((a, b) => a - b);
    // Refused attempts gave their person and address slots back; the session row is capped.
    expect(counts).toEqual([
      limits.session,
      limits.session,
      limits.session + 1,
    ]);
    expect((await checkStepUpProofBudget(subject)).allowed).toBe(false);
  });

  it("P0R2-01: a verified proof clears person and session and refunds its address slot", async () => {
    const subject = {
      personId: "p0r2-ok-person",
      sessionId: "p0r2-ok-session",
      clientIp: "203.0.113.51",
    };
    const failed = await reserveStepUpProofAttempt(subject);
    await settleStepUpProofAttempt(subject, failed, false);
    const ok = await reserveStepUpProofAttempt(subject);
    expect(ok.allowed).toBe(true);
    await settleStepUpProofAttempt(subject, ok, true);
    const rows = await db
      .select()
      .from(schema.requestRateLimitCounterTable)
      .where(
        eq(schema.requestRateLimitCounterTable.bucket, "step_up_proof_failure"),
      );
    // Only the address counter survives, holding the one real failure.
    expect(rows.map((r) => r.count)).toEqual([1]);
  });

  it("P0R2-01: concurrent wrong proofs on distinct challenges verify at most the budget", async () => {
    const { personId, sessionId } = await adminSession("p0r2-race-admin");
    const { app } = createApp();
    const limit = STEP_UP_BUDGET_LIMITS.step_up_proof_failure.session;
    // One slot left. A session holds one live challenge per operation, so two different
    // operations give two simultaneously valid challenges that both pass the early check.
    for (let i = 0; i < limit - 1; i += 1)
      await recordStepUpProofFailure({ personId, sessionId, clientIp: null });
    const [target] = await db
      .insert(schema.userTable)
      .values({
        id: "p0r2-target",
        name: "target",
        email: "p0r2-target@example.test",
      })
      .returning();
    const bindings = [
      { operation: "metrics_token_rotate", version: 1 },
      { operation: "instance_admin_grant", targetUserId: target?.id ?? "" },
    ];
    const proofs: Array<Record<string, unknown>> = [];
    for (const binding of bindings) {
      const challenge = await post(app, "/api/me/step-up/challenges", {
        kind: "operation",
        ...binding,
      });
      expect(challenge.status, await challenge.clone().text()).toBe(200);
      const { challengeId, nonce } = (await challenge.json()) as {
        challengeId: string;
        nonce: string;
      };
      proofs.push({
        kind: "operation",
        ...binding,
        challengeId,
        nonce,
        method: "password",
        password: "wrong-password",
      });
    }
    const responses = await Promise.all(
      proofs.map((body) => post(app, "/api/me/step-up", body)),
    );
    const statuses = responses.map((r) => r.status).sort();
    // Exactly one proof was checked against the credential; the other was refused.
    expect(statuses).toEqual([403, 429]);
    const limited = responses.find((r) => r.status === 429);
    expect(limited?.headers.get("retry-after")).toBeTruthy();
    expect(await limited?.text()).toBe("step_up_attempt_limit");
    const counters = await db
      .select({ count: schema.requestRateLimitCounterTable.count })
      .from(schema.requestRateLimitCounterTable)
      .where(
        eq(schema.requestRateLimitCounterTable.bucket, "step_up_proof_failure"),
      );
    // Only the verified failure was counted: the lower counter sits exactly at the limit, and
    // the session counter is at most capped at limit + 1 (the refusal may come from either the
    // early check or the reservation, depending on interleaving).
    const sorted = counters.map((r) => r.count).sort((x, y) => x - y);
    expect(sorted[0]).toBe(limit);
    expect(sorted[1]).toBeGreaterThanOrEqual(limit);
    expect(sorted[1]).toBeLessThanOrEqual(limit + 1);
  });
});
