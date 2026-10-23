import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect } from "vitest";
import { getConfiguredAgentOrigin } from "../../../apps/api/src/auth";
import db, { schema } from "../../../apps/api/src/database";
import { withConfiguredAgentAuthority } from "./agent-authority";
import { csrfRequest } from "./csrf";

/**
 * Shared flow for the P0 deletion contract: every durable DELETE answers 202 and
 * changes nothing; the requester then approves through the real
 * `POST /api/me/pending-actions/{id}/approve` endpoint (typed name / count plus a
 * PA-15 step-up proof where the pending action demands it).
 *
 * The caller must already have mocked its session with `mockAuthenticatedSession`.
 * The approval layer re-validates the credential against a live `session` row, so
 * `ensureAgentSession` persists the row that mock describes (`session-<userId>`).
 */

const apiRequire = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(password: string, rounds: number): Promise<string>;
};

type App = {
  request: (
    input: string | Request,
    init?: RequestInit,
  ) => Response | Promise<Response>;
};

export type PendingDeletionBody = {
  pendingActionId: string;
  action: string;
  confirmation: string;
  summary: Record<string, unknown>;
  approveUrl?: string;
};

/** Persist the agent session row that `mockAuthenticatedSession(user)` describes. */
export async function ensureAgentSession(userId: string) {
  await db
    .insert(schema.sessionTable)
    .values({
      id: `session-${userId}`,
      token: randomUUID(),
      userId,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .onConflictDoNothing();
}

function agentRequest(app: App, url: string, body: unknown) {
  const req = withConfiguredAgentAuthority(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return app.request(req.input, req.init);
}

/** Mint a single-use PA-15 proof for one pending action (local password method). */
export async function stepUpProof(
  app: App,
  userId: string,
  pendingActionId: string,
) {
  const password = "delete-local-password";
  await db
    .insert(schema.accountTable)
    .values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: await bcrypt.hash(password, 4),
    })
    .onConflictDoNothing();
  const challenge = await agentRequest(app, "/api/me/step-up/challenges", {
    kind: "pending_action",
    pendingActionId,
  });
  expect(challenge.status, await challenge.clone().text()).toBe(200);
  const data = (await challenge.json()) as {
    challengeId: string;
    nonce: string;
  };
  const verified = await agentRequest(app, "/api/me/step-up", {
    kind: "pending_action",
    pendingActionId,
    challengeId: data.challengeId,
    nonce: data.nonce,
    method: "password",
    password,
  });
  expect(verified.status, await verified.clone().text()).toBe(200);
  return ((await verified.json()) as { token: string }).token;
}

/**
 * Approve a 202 pending deletion as its requester. Returns the raw approve response so
 * a caller can assert both success (200, state "executed") and failure outcomes.
 */
export async function approvePendingDeletion(
  app: App,
  userId: string,
  pending: PendingDeletionBody,
  options: { typedName?: string; typedCount?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (/step_up/.test(pending.confirmation)) {
    headers["x-taskdesk-step-up-token"] = await stepUpProof(
      app,
      userId,
      pending.pendingActionId,
    );
  }
  return app.request(
    `/api/me/pending-actions/${pending.pendingActionId}/approve`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...(options.typedName !== undefined
          ? { typedName: options.typedName }
          : {}),
        ...(options.typedCount !== undefined
          ? { typedCount: options.typedCount }
          : {}),
      }),
    },
  );
}

/**
 * Request a deletion and read the 202 body (asserting the contract), without approving.
 * `init` carries any extra headers/body the route needs.
 */
export async function requestDeletion(
  app: App,
  url: string,
  init: RequestInit = {},
): Promise<PendingDeletionBody> {
  const response = await app.request(url, { method: "DELETE", ...init });
  expect(response.status, await response.clone().text()).toBe(202);
  return (await response.json()) as PendingDeletionBody;
}

/**
 * Full happy path: DELETE answers 202, then the requester approves and the approval
 * answers 200 `executed`. Returns the pending body and the approval result.
 */
export async function deleteThroughApproval(
  app: App,
  user: { id: string },
  url: string,
  options: {
    init?: RequestInit;
    typedName?: string;
    typedCount?: string;
    /** Called between request and approval to prove nothing was deleted yet. */
    afterRequest?: (pending: PendingDeletionBody) => Promise<void>;
  } = {},
) {
  const pending = await requestDeletion(app, url, options.init);
  await options.afterRequest?.(pending);
  const approved = await approvePendingDeletion(app, user.id, pending, options);
  expect(approved.status, await approved.clone().text()).toBe(200);
  const result = (await approved.json()) as {
    id: string;
    state: string;
    result?: unknown;
  };
  expect(result.state).toBe("executed");
  return { pending, result };
}

/** Default password `signUpUser` registers; real cookie-session actors prove step-up with it. */
export const SIGNED_UP_USER_PASSWORD = "correct horse battery staple";

/**
 * Same approval for a REAL cookie session (users made by `signUpUser`). Pass `typedName` for
 * a typed-name pending action (project/workspace) or `typedCount` for a bulk deletion;
 * a step-up pending action gets its PA-15 proof minted with the sign-up password.
 */
export async function approvePendingDeletionAsCookie(
  app: App,
  cookie: string,
  pending: PendingDeletionBody,
  options: { typedName?: string; typedCount?: string; password?: string } = {},
) {
  const origin = getConfiguredAgentOrigin();
  const post = (
    path: string,
    body: unknown,
    extra: Record<string, string> = {},
  ) =>
    csrfRequest(
      app as Parameters<typeof csrfRequest>[0],
      `${origin}${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, ...extra },
        body: JSON.stringify(body),
      },
      cookie,
    );
  const headers: Record<string, string> = {};
  if (/step_up/.test(pending.confirmation)) {
    const challenge = await post("/api/me/step-up/challenges", {
      kind: "pending_action",
      pendingActionId: pending.pendingActionId,
    });
    expect(challenge.status, await challenge.clone().text()).toBe(200);
    const data = (await challenge.json()) as {
      challengeId: string;
      nonce: string;
    };
    const verified = await post("/api/me/step-up", {
      kind: "pending_action",
      pendingActionId: pending.pendingActionId,
      challengeId: data.challengeId,
      nonce: data.nonce,
      method: "password",
      password: options.password ?? SIGNED_UP_USER_PASSWORD,
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    headers["x-taskdesk-step-up-token"] = (
      (await verified.json()) as { token: string }
    ).token;
  }
  return post(
    `/api/me/pending-actions/${pending.pendingActionId}/approve`,
    {
      ...(options.typedName !== undefined
        ? { typedName: options.typedName }
        : {}),
      ...(options.typedCount !== undefined
        ? { typedCount: options.typedCount }
        : {}),
    },
    headers,
  );
}

/** Cookie-session happy path: DELETE answers 202, approve answers 200 `executed`. */
export async function deleteThroughApprovalAsCookie(
  app: App,
  cookie: string,
  path: string,
  options: {
    typedName?: string;
    typedCount?: string;
    afterRequest?: (pending: PendingDeletionBody) => Promise<void>;
  } = {},
) {
  const origin = getConfiguredAgentOrigin();
  const response = await csrfRequest(
    app as Parameters<typeof csrfRequest>[0],
    `${origin}${path}`,
    { method: "DELETE", headers: { cookie } },
    cookie,
  );
  expect(response.status, await response.clone().text()).toBe(202);
  const pending = (await response.json()) as PendingDeletionBody;
  await options.afterRequest?.(pending);
  const approved = await approvePendingDeletionAsCookie(
    app,
    cookie,
    pending,
    options,
  );
  expect(approved.status, await approved.clone().text()).toBe(200);
  const result = (await approved.json()) as { id: string; state: string };
  expect(result.state).toBe("executed");
  return { pending, result };
}
