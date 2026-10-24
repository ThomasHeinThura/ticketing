import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import { csrfRequest } from "./csrf";
import {
  type App,
  extractSessionCookie,
  nextClientIp,
} from "./organization-http";

/** The password every helper-created test user signs up with (`organization-http.ts`). */
export const TEST_USER_PASSWORD = "correct horse battery staple";

/** The header that carries a one-use PA-15 proof on an elevated route. */
export const STEP_UP_TOKEN_HEADER = "x-taskdesk-step-up-token";

async function postJson(
  app: App,
  cookie: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return csrfRequest(
    app,
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

/**
 * Obtains one single-use proof token for `operation` through the real challenge and proof
 * endpoints, with the local password method. Returns `null` when the challenge is refused (an
 * invalid body, a caller without the authority, a missing target): the caller then sends the
 * request without a proof and the route's own refusal is what the test observes, because every
 * elevated route spends its proof only after its other checks.
 *
 * The per-(session, operation) challenge limit is a production control; a long test that
 * performs many writes from one session clears its own finished rows first so that the limit
 * does not become the thing under test. The proof itself is never forged or bypassed.
 */
export async function mintStepUpToken(
  app: App,
  cookie: string,
  operation: string,
  fields: Record<string, unknown>,
  password: string = TEST_USER_PASSWORD,
): Promise<string | null> {
  await db.execute(
    sql`DELETE FROM step_up_confirmation WHERE operation_key = ${operation} AND state <> 'issued'`,
  );
  const challenge = await postJson(app, cookie, "/api/me/step-up/challenges", {
    kind: "operation",
    operation,
    ...fields,
  });
  if (challenge.status !== 200) return null;
  const issued = (await challenge.json()) as {
    challengeId: string;
    nonce: string;
  };
  const proof = await postJson(app, cookie, "/api/me/step-up", {
    kind: "operation",
    operation,
    ...fields,
    challengeId: issued.challengeId,
    nonce: issued.nonce,
    method: "password",
    password,
  });
  if (proof.status !== 200) return null;
  return ((await proof.json()) as { token: string }).token;
}

/** How a helper treats the step-up proof: mint one (default), send none, or send this token. */
export type StepUpOption = boolean | string | undefined;

/** The headers for an elevated write, minting a proof unless told otherwise. */
export async function stepUpHeaders(
  app: App,
  cookie: string,
  option: StepUpOption,
  operation: string,
  fields: Record<string, unknown>,
): Promise<Record<string, string>> {
  if (option === false) return {};
  const token =
    typeof option === "string"
      ? option
      : await mintStepUpToken(app, cookie, operation, fields);
  return token ? { [STEP_UP_TOKEN_HEADER]: token } : {};
}

const bcrypt = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
)("bcryptjs") as { hash(value: string, rounds: number): Promise<string> };

/**
 * For suites that authenticate with a mocked session (`mockAuthenticatedSession`): gives that
 * mocked session (`session-<userId>`) a real, active session row and the user a credential
 * account, so the genuine challenge and proof endpoints can verify it. Nothing about the proof
 * flow is faked; only the sign-in that created the session was.
 */
export async function seedMockedSessionForStepUp(
  userId: string,
  password: string = TEST_USER_PASSWORD,
): Promise<void> {
  await db
    .insert(schema.sessionTable)
    .values({
      id: `session-${userId}`,
      token: `token-${userId}`,
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      portal: "agent",
    })
    .onConflictDoNothing();
  await db
    .insert(schema.accountTable)
    .values({
      id: `${userId}-credential`,
      accountId: userId,
      providerId: "credential",
      userId,
      password: await bcrypt.hash(password, 4),
    })
    .onConflictDoNothing();
}

/**
 * A second, independent browser session for an existing user, through the real sign-in route.
 * A step-up proof belongs to one session, and a newer proof for the same session and operation
 * supersedes an older one, so a test that fires two elevated writes from "the same person" at
 * once needs one session per request, each with its own proof obtained beforehand.
 */
export async function signInAgain(
  app: App,
  email: string,
  password: string = TEST_USER_PASSWORD,
): Promise<string> {
  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextClientIp(),
    },
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 200)
    throw new Error(`signInAgain failed with ${response.status}`);
  return extractSessionCookie(response);
}
