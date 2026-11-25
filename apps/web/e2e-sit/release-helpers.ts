import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Browser, BrowserContext } from "@playwright/test";
import { privateRequest } from "../../../tests/e2e/helpers/fill-sensitive";
import {
  sitAccountsFile,
  sitAgentOrigin,
  sitPortalOrigin,
} from "../../../tests/e2e/helpers/sit-release-env";

/**
 * Shared sign-in and API plumbing for the release journeys (`pnpm test:release`).
 *
 * Accounts come from SIT_ACCOUNTS_FILE, a private JSON array (or { accounts }) of
 * { role, host: "agent" | "portal", email, password }. Passwords never leave this module and
 * every request that carries them or a session cookie runs through privateRequest, so a
 * failure message cannot echo them. Journeys create their own fixtures and remove them again.
 */
export const agentOrigin = sitAgentOrigin;
export const portalOrigin = sitPortalOrigin;
export const workspaceId = "uat-ws";

/**
 * Chromium cannot be told to trust the local SIT certificate (Node uses NODE_EXTRA_CA_CERTS),
 * so only *.localhost stacks skip the check, the same rule as scripts/sit/release-smoke.mjs.
 * Any other host is verified strictly.
 */
export const ignoreHTTPSErrors = (origin: string) =>
  new URL(origin).hostname.endsWith(".localhost");

export type Role =
  | "owner"
  | "admin"
  | "manager"
  | "lead"
  | "member"
  | "viewer"
  | "customer";

type Account = { role: string; host: string; email: string; password: string };

function account(role: Role): Account {
  const file = sitAccountsFile;
  if (!file) throw new Error("SIT_ACCOUNTS_FILE is required.");
  const raw = JSON.parse(readFileSync(file, "utf8")) as
    | Account[]
    | { accounts: Account[] };
  const found = (Array.isArray(raw) ? raw : raw.accounts).find(
    (candidate) => candidate.role === role,
  );
  if (!found) throw new Error(`No ${role} account in SIT_ACCOUNTS_FILE.`);
  return found;
}

// biome-ignore lint/suspicious/noExplicitAny: journeys assert on the fields they need
export type Reply = { status: number; body: any };

export type Session = {
  role: Role;
  origin: string;
  context: BrowserContext;
  /** Authenticated JSON call; every mutation carries a fresh CSRF token and Origin. */
  call(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Reply>;
};

/** A fresh browser context signed in as `role` (portal host for the customer). */
export async function signIn(browser: Browser, role: Role): Promise<Session> {
  const who = account(role);
  const origin = who.host === "portal" ? portalOrigin : agentOrigin;
  const context = await browser.newContext({
    ignoreHTTPSErrors: ignoreHTTPSErrors(origin),
    locale: "en-US",
    colorScheme: "light",
    viewport: { width: 1440, height: 960 },
  });
  // SIT rate-limits sign-ins per IP; wait out a 429 instead of failing the journey.
  for (let attempt = 0; ; attempt += 1) {
    const status = await privateRequest(async () => {
      const response = await context.request.post(
        `${origin}/api/auth/sign-in/email`,
        {
          headers: { Origin: origin },
          data: { email: who.email, password: who.password },
        },
      );
      return response.status();
    });
    if (status === 200) break;
    if (status !== 429 || attempt >= 5)
      throw new Error(`Sign-in as ${role} returned HTTP ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  const call: Session["call"] = (method, path, body, headers = {}) =>
    privateRequest(async () => {
      const all: Record<string, string> = { Origin: origin, ...headers };
      if (method !== "GET") {
        const issued = await context.request.get(
          `${origin}/api/me/csrf-token`,
          { headers: { Origin: origin } },
        );
        const { token } = (await issued.json()) as { token: string };
        all["X-TaskDesk-CSRF"] = token;
        all["X-TaskDesk-Window-Id"] = randomUUID();
      }
      const response = await context.request.fetch(`${origin}/api${path}`, {
        method,
        headers: all,
        data: body,
      });
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      return { status: response.status(), body: parsed };
    });
  return { role, origin, context, call };
}

/** Unique, sortable suffix that marks a fixture as this run's. */
export const stamp = () =>
  `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID().slice(0, 4)}`;

/** Delete a work item the journey created; its requester approves the pending action. */
export async function removeWorkItem(session: Session, key: string) {
  const deleted = await session.call("DELETE", `/work-items/${key}`);
  const id = deleted.body?.pendingActionId as string | undefined;
  if (deleted.status !== 202 || !id)
    throw new Error(`Cleanup of ${key} returned HTTP ${deleted.status}.`);
  const approved = await session.call(
    "POST",
    `/me/pending-actions/${id}/approve`,
    {},
  );
  if (approved.status !== 200)
    throw new Error(
      `Cleanup approval of ${key} returned HTTP ${approved.status}.`,
    );
}
