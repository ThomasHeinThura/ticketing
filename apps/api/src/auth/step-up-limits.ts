/**
 * PA-15 / P0R1-02: step-up challenge creation and failed credential proofs are budgeted per
 * session, per person and per client address across ALL pending actions and operations, so
 * cancelling and re-requesting an action (new pending action, new per-action budget) cannot
 * reset the allowance. The per-binding limits in `step-up-service.ts` stay as the inner bound.
 *
 * Counters live in the shared `request_rate_limit_counter` table (keyed HMAC digests, no raw
 * person, session or address is stored) with a fixed 15 minute window. A successful proof clears
 * the person and session failure counters; the address counter is only ever drained by the
 * window, so one valid account cannot launder an attacker on the same address.
 */
import { createHmac } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import db, { schema } from "../database";
import { rateLimitClientAddress } from "../identity/home-realm-rate-limit";
import { resolveAuthSecret } from "../utils/require-auth-secret";

export type StepUpBudgetBucket = "step_up_challenge" | "step_up_proof_failure";

export const STEP_UP_BUDGET_WINDOW_MS = 15 * 60_000;
export const STEP_UP_BUDGET_LIMITS = {
  step_up_challenge: { session: 15, person: 30, ip: 60 },
  step_up_proof_failure: { session: 8, person: 12, ip: 40 },
} as const;

export type StepUpBudgetDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  /** The limit of the scope that refused, for the 429 body. */
  limit: number;
};

type Scope = "session" | "person" | "ip";
export type StepUpBudgetSubject = {
  personId: string;
  sessionId: string;
  /** From `clientIpForContext` (trusted-proxy hop count); null skips the address budget. */
  clientIp: string | null;
};

function digest(bucket: StepUpBudgetBucket, scope: Scope, value: string) {
  const secret = resolveAuthSecret(process.env.TASKDESK_AUTH_SECRET);
  if (!secret.ok) throw new Error("Step-up limiter unavailable");
  return createHmac("sha256", secret.secret)
    .update(bucket)
    .update("\0")
    .update(scope)
    .update("\0")
    .update(value)
    .digest("hex");
}

function scopes(
  subject: StepUpBudgetSubject,
): ReadonlyArray<readonly [Scope, string]> {
  const keyed: Array<readonly [Scope, string]> = [
    ["session", subject.sessionId],
    ["person", subject.personId],
  ];
  // Without a resolvable client address only the session and person budgets apply: one shared
  // "unknown address" bucket would let any caller exhaust step-up for everyone. IPv6 is keyed on
  // its /64 (IPv4-mapped on the embedded IPv4) so rotating addresses inside one prefix does not
  // reset the budget.
  if (subject.clientIp)
    keyed.push(["ip", rateLimitClientAddress(subject.clientIp)]);
  return keyed;
}

type CounterRow = {
  count: number;
  window_started_at: Date | string;
  now: Date | string;
};
const asDate = (value: Date | string) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new Error("Step-up limiter unavailable");
  return parsed;
};
const retryAfter = (row: CounterRow) =>
  Math.max(
    1,
    Math.ceil(
      (asDate(row.window_started_at).getTime() +
        STEP_UP_BUDGET_WINDOW_MS -
        asDate(row.now).getTime()) /
        1000,
    ),
  );

async function hit(bucket: StepUpBudgetBucket, scope: Scope, value: string) {
  const keyHash = digest(bucket, scope, value);
  const limit = STEP_UP_BUDGET_LIMITS[bucket][scope];
  const table = schema.requestRateLimitCounterTable;
  const result = await db.execute(sql`
    WITH rate_clock AS (SELECT clock_timestamp() AS now)
    INSERT INTO ${table}
      (bucket, key_hash, window_started_at, count, expires_at, created_at, updated_at)
    SELECT ${bucket}, ${keyHash}, rate_clock.now, 1,
      rate_clock.now + (${STEP_UP_BUDGET_WINDOW_MS} * interval '1 millisecond'),
      rate_clock.now, rate_clock.now
    FROM rate_clock
    ON CONFLICT (bucket, key_hash) DO UPDATE SET
      window_started_at = CASE
        WHEN ${table}.window_started_at + (${STEP_UP_BUDGET_WINDOW_MS} * interval '1 millisecond')
          <= EXCLUDED.window_started_at THEN EXCLUDED.window_started_at
        ELSE ${table}.window_started_at
      END,
      count = CASE
        WHEN ${table}.window_started_at + (${STEP_UP_BUDGET_WINDOW_MS} * interval '1 millisecond')
          <= EXCLUDED.window_started_at THEN 1
        ELSE LEAST(${table}.count + 1, ${limit} + 1)
      END,
      expires_at = CASE
        WHEN ${table}.window_started_at + (${STEP_UP_BUDGET_WINDOW_MS} * interval '1 millisecond')
          <= EXCLUDED.window_started_at THEN EXCLUDED.expires_at
        ELSE ${table}.expires_at
      END,
      updated_at = EXCLUDED.updated_at
    RETURNING count, window_started_at, clock_timestamp() AS now,
      (extract(epoch FROM window_started_at) * 1000000)::bigint::text AS window_us
  `);
  const row = result.rows[0] as
    | (CounterRow & { window_us: string })
    | undefined;
  if (!row) throw new Error("Step-up limiter unavailable");
  return {
    allowed: row.count <= limit,
    retryAfterSeconds: retryAfter(row),
    limit,
    keyHash,
    // Microsecond window identity: a JavaScript Date would drop the precision PostgreSQL keeps.
    windowKey: row.window_us,
  };
}

/** Gives back one slot taken by `hit`, only while the same window is still current. */
async function refund(
  bucket: StepUpBudgetBucket,
  keyHash: string,
  windowKey: string,
) {
  const table = schema.requestRateLimitCounterTable;
  await db.execute(sql`
    UPDATE ${table}
    SET count = GREATEST(${table}.count - 1, 0), updated_at = clock_timestamp()
    WHERE ${table}.bucket = ${bucket}
      AND ${table}.key_hash = ${keyHash}
      AND (extract(epoch FROM ${table}.window_started_at) * 1000000)::bigint = ${windowKey}::bigint
  `);
}

async function peek(bucket: StepUpBudgetBucket, scope: Scope, value: string) {
  const keyHash = digest(bucket, scope, value);
  const limit = STEP_UP_BUDGET_LIMITS[bucket][scope];
  const result = await db.execute(sql`
    SELECT count, window_started_at, clock_timestamp() AS now
    FROM ${schema.requestRateLimitCounterTable}
    WHERE bucket = ${bucket} AND key_hash = ${keyHash}
  `);
  const row = result.rows[0] as CounterRow | undefined;
  if (!row) return { allowed: true, retryAfterSeconds: 0, limit };
  const expired =
    asDate(row.now).getTime() - asDate(row.window_started_at).getTime() >=
    STEP_UP_BUDGET_WINDOW_MS;
  if (expired || row.count < limit)
    return { allowed: true, retryAfterSeconds: 0, limit };
  return { allowed: false, retryAfterSeconds: retryAfter(row), limit };
}

function merge(decisions: StepUpBudgetDecision[]): StepUpBudgetDecision {
  const refused = decisions.filter((decision) => !decision.allowed);
  if (refused.length === 0)
    return {
      allowed: true,
      retryAfterSeconds: 0,
      limit: decisions[0]?.limit ?? 0,
    };
  const worst = refused.reduce((a, b) =>
    b.retryAfterSeconds > a.retryAfterSeconds ? b : a,
  );
  return {
    allowed: false,
    retryAfterSeconds: worst.retryAfterSeconds,
    limit: worst.limit,
  };
}

/** Consumes one challenge creation from the session, person and address budgets. */
export async function consumeStepUpChallengeBudget(
  subject: StepUpBudgetSubject,
): Promise<StepUpBudgetDecision> {
  const decisions: StepUpBudgetDecision[] = [];
  for (const [scope, value] of scopes(subject))
    decisions.push(await hit("step_up_challenge", scope, value));
  return merge(decisions);
}

/**
 * Refuses a proof attempt while a failed-proof budget is spent; does not count. A cheap early
 * refusal only: the binding decision is `reserveStepUpProofAttempt`.
 */
export async function checkStepUpProofBudget(
  subject: StepUpBudgetSubject,
): Promise<StepUpBudgetDecision> {
  const decisions: StepUpBudgetDecision[] = [];
  for (const [scope, value] of scopes(subject))
    decisions.push(await peek("step_up_proof_failure", scope, value));
  return merge(decisions);
}

export type StepUpProofReservation = StepUpBudgetDecision & {
  /** Slots this reservation took; refunded when the proof verifies. */
  held: ReadonlyArray<{ scope: Scope; keyHash: string; windowKey: string }>;
};

/**
 * P0R2-01: atomically takes one failed-proof slot from every budget BEFORE the credential is
 * verified, so concurrent proofs on distinct challenges cannot all pass a separate check. Each
 * slot is an `INSERT … ON CONFLICT DO UPDATE … RETURNING` under the counter row lock. When any
 * budget refuses, the slots taken from the others are given back and the attempt must not be
 * verified. Settle with `settleStepUpProofAttempt` once the outcome is known.
 */
export async function reserveStepUpProofAttempt(
  subject: StepUpBudgetSubject,
): Promise<StepUpProofReservation> {
  const taken: Array<Awaited<ReturnType<typeof hit>> & { scope: Scope }> = [];
  for (const [scope, value] of scopes(subject)) {
    const slot = await hit("step_up_proof_failure", scope, value);
    taken.push({ ...slot, scope });
    // Stop at the first refusal: a refused attempt never touches the wider budgets, so one
    // spent session cannot inflate its person or address counters.
    if (!slot.allowed) break;
  }
  const decision = merge(taken);
  const held = taken
    .filter((slot) => slot.allowed)
    .map(({ scope, keyHash, windowKey }) => ({ scope, keyHash, windowKey }));
  if (!decision.allowed) {
    // A refused budget never increments past `limit + 1`, so only the accepted slots return.
    for (const slot of held)
      await refund("step_up_proof_failure", slot.keyHash, slot.windowKey);
    return { ...decision, held: [] };
  }
  return { ...decision, held };
}

/**
 * A failed proof keeps its reserved slots (it is the counted failure). A verified proof clears
 * the person and session counters and refunds its address slot, which only the window drains.
 */
export async function settleStepUpProofAttempt(
  subject: Pick<StepUpBudgetSubject, "personId" | "sessionId">,
  reservation: StepUpProofReservation,
  verified: boolean,
): Promise<void> {
  if (!verified) return;
  await clearStepUpProofFailures(subject);
  for (const slot of reservation.held)
    if (slot.scope === "ip")
      await refund("step_up_proof_failure", slot.keyHash, slot.windowKey);
}

/** Counts one failed credential verification (password, TOTP or backup code). */
export async function recordStepUpProofFailure(
  subject: StepUpBudgetSubject,
): Promise<void> {
  for (const [scope, value] of scopes(subject))
    await hit("step_up_proof_failure", scope, value);
}

/** A verified proof clears the person and session failure counters (never the address one). */
export async function clearStepUpProofFailures(
  subject: Pick<StepUpBudgetSubject, "personId" | "sessionId">,
): Promise<void> {
  const keys = [
    digest("step_up_proof_failure", "session", subject.sessionId),
    digest("step_up_proof_failure", "person", subject.personId),
  ];
  await db
    .delete(schema.requestRateLimitCounterTable)
    .where(
      and(
        eq(schema.requestRateLimitCounterTable.bucket, "step_up_proof_failure"),
        inArray(schema.requestRateLimitCounterTable.keyHash, keys),
      ),
    );
}
