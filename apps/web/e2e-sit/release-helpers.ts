import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Browser, BrowserContext } from "@playwright/test";
import { privateRequest } from "../../../tests/e2e/helpers/fill-sensitive";
import {
  sitAccountsFile,
  sitAgentOrigin,
  sitPortalOrigin,
  sitReleaseProject,
  sitReleaseWorkspace,
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
  | "customer"
  /** Customer of a different organisation (optional account). */
  | "customer-other"
  /** Instance administrator (optional account; enables the import apply journey). */
  | "instance-admin";

type Account = { role: string; host: string; email: string; password: string };

function findAccount(role: Role): Account | undefined {
  const file = sitAccountsFile;
  if (!file) throw new Error("SIT_ACCOUNTS_FILE is required.");
  const raw = JSON.parse(readFileSync(file, "utf8")) as
    | Account[]
    | { accounts: Account[] };
  return (Array.isArray(raw) ? raw : raw.accounts).find(
    (candidate) => candidate.role === role,
  );
}

/** Whether SIT_ACCOUNTS_FILE holds an account for one of the optional roles. */
export const hasAccount = (role: Role) => findAccount(role) !== undefined;

function account(role: Role): Account {
  const found = findAccount(role);
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

/** The rows of a list reply, whether it is a bare array or wraps one (`data`, `projects`, ...). */
export function rowsOf<T = Record<string, unknown>>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object")
    for (const value of Object.values(body))
      if (Array.isArray(value)) return value as T[];
  return [];
}

export type Target = {
  workspaceId: string;
  projectId: string;
  projectKey: string;
};

type Named = { id: string; name?: string; key?: string; slug?: string };
const matches = (row: Named, wanted: string) =>
  [row.id, row.name, row.key, row.slug].some(
    (field) => field?.toLowerCase() === wanted.toLowerCase(),
  );

/**
 * The workspace and project a journey works in, found through the API as the signed-in user so
 * the suite runs on any deployment. SIT_RELEASE_WORKSPACE / SIT_RELEASE_PROJECT pin them by
 * name, slug, key or id; otherwise it takes the first workspace and the first project the
 * session can create a (non-epic) work item in.
 */
export async function discoverTarget(session: Session): Promise<Target> {
  const workspaces = rowsOf<Named>(
    (await session.call("GET", "/workspace")).body,
  );
  const workspace = sitReleaseWorkspace
    ? workspaces.find((row) => matches(row, sitReleaseWorkspace))
    : workspaces[0];
  if (!workspace)
    throw new Error("No workspace found for the release suite user.");
  const projects = rowsOf<Named>(
    (await session.call("GET", `/project?workspaceId=${workspace.id}`)).body,
  );
  const candidates = sitReleaseProject
    ? projects.filter((row) => matches(row, sitReleaseProject))
    : projects;
  for (const project of candidates) {
    const types = await session.call(
      "GET",
      `/projects/${project.id}/creatable-work-item-types`,
    );
    if (
      Array.isArray(types.body) &&
      types.body.some((type: { isEpic: boolean }) => !type.isEpic)
    )
      return {
        workspaceId: workspace.id,
        projectId: project.id,
        projectKey: project.key ?? project.slug ?? project.id,
      };
  }
  throw new Error("No project accepts a work item for the release suite user.");
}

/** A creatable work item type of the project that is neither an epic nor a change. */
export async function taskTypeId(session: Session, projectId: string) {
  const types = await session.call(
    "GET",
    `/projects/${projectId}/creatable-work-item-types`,
  );
  const plain = (
    types.body as Array<{ id: string; isEpic: boolean; isChange: boolean }>
  ).filter((type) => !type.isEpic && !type.isChange);
  if (!plain[0]) throw new Error("The project has no plain work item type.");
  return plain[0].id;
}

/** Delete a resource the journey created; a 202 is a pending action its requester approves. */
export async function removeResource(session: Session, path: string) {
  const deleted = await session.call("DELETE", path);
  if (deleted.status === 200 || deleted.status === 204) return;
  const id = deleted.body?.pendingActionId as string | undefined;
  if (deleted.status !== 202 || !id)
    throw new Error(`Cleanup of ${path} returned HTTP ${deleted.status}.`);
  const approved = await session.call(
    "POST",
    `/me/pending-actions/${id}/approve`,
    {},
  );
  if (approved.status !== 200)
    throw new Error(
      `Cleanup approval of ${path} returned HTTP ${approved.status}.`,
    );
}

/** Whether a feature flag is on for the project, as the API resolves it. */
export async function featureOn(
  session: Session,
  projectId: string,
  key: string,
) {
  const resolved = await session.call(
    "GET",
    `/features/resolved?project=${projectId}`,
  );
  return Boolean(
    (resolved.body?.features as Array<{ key: string; enabled: boolean }>)?.find(
      (feature) => feature.key === key,
    )?.enabled,
  );
}

/** Set a project-level feature override (`null` inherits); returns the override it replaced. */
export async function setProjectFeature(
  admin: Session,
  projectId: string,
  key: string,
  enabled: boolean | null,
) {
  const before = await admin.call("GET", `/projects/${projectId}/features`);
  const prior =
    (
      before.body?.features as Array<{ key: string; override: boolean | null }>
    )?.find((feature) => feature.key === key)?.override ?? null;
  const changed = await admin.call("PATCH", `/projects/${projectId}/features`, {
    changes: [{ key, enabled }],
  });
  if (changed.status !== 200)
    throw new Error(`Setting ${key} returned HTTP ${changed.status}.`);
  return prior;
}
