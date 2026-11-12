import { eq } from "drizzle-orm";
import { getConfiguredAgentOrigin } from "../../../apps/api/src/auth";
import db, { schema } from "../../../apps/api/src/database";
import { csrfRequest } from "./csrf";
import type { App } from "./organization-http";
import {
  approvePendingDeletionAsCookie,
  type PendingDeletionBody,
} from "./pending-deletion";

// HTTP helpers for the S4 NATIVE workspace write routes (issue #6, retrofit
// plan §3, S4 row). Deliberately separate from `organization-http.ts`, which
// drives the INHERITED plugin routes and is part of the frozen S1 oracle's
// file set — that file must stay byte-identical to `main`, so nothing here
// may be added to it.
//
// Like its plugin counterpart these return the raw Response, so callers
// assert on database state and status codes rather than on a response shape.

export type CreateWorkspaceBody = {
  name?: unknown;
  slug?: unknown;
  logo?: unknown;
  description?: unknown;
  ownerUserId?: unknown;
};

/**
 * `POST /api/workspace` exactly as given: no instance-admin elevation, no owner defaulting. Use it
 * for the permission tests that assert who may create, and with whom as owner. A missing `name`
 * gets a default; every other field is sent only when the caller passes it.
 */
export async function postCreateWorkspace(
  app: App,
  cookie: string,
  body: CreateWorkspaceBody = {},
): Promise<Response> {
  return csrfRequest(
    app,
    "/api/workspace",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Characterization Workspace",
        ...body,
      }),
    },
    cookie,
  );
}

/** Makes an existing user a current instance administrator the way the first-user bootstrap does. */
export async function grantInstanceAdminForTest(userId: string): Promise<void> {
  await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, userId));
}

// Role changes for `createWorkspaceNative` run through one queue so a release can never
// interleave with a concurrent acquire for the same user. The request itself is NOT queued:
// the concurrent-create race tests need their requests to overlap.
const holders = new Map<
  string,
  { count: number; previousRole: string | null }
>();
let roleChanges: Promise<unknown> = Promise.resolve();

function queueRoleChange(change: () => Promise<void>): Promise<void> {
  const next = roleChanges.then(change, change);
  roleChanges = next.catch(() => undefined);
  return next;
}

function acquireInstanceAdmin(userId: string): Promise<void> {
  return queueRoleChange(async () => {
    const held = holders.get(userId);
    if (held) {
      held.count += 1;
      return;
    }
    const [row] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, userId));
    holders.set(userId, { count: 1, previousRole: row?.role ?? null });
    await grantInstanceAdminForTest(userId);
  });
}

function releaseInstanceAdmin(userId: string): Promise<void> {
  return queueRoleChange(async () => {
    const held = holders.get(userId);
    if (!held) return;
    held.count -= 1;
    if (held.count > 0) return;
    holders.delete(userId);
    await db
      .update(schema.userTable)
      .set({ role: held.previousRole })
      .where(eq(schema.userTable.id, userId));
  });
}

async function sessionUserId(app: App, cookie: string): Promise<string> {
  const response = await app.request("/api/auth/get-session", {
    headers: { cookie, origin: getConfiguredAgentOrigin() },
  });
  const body = (await response.json()) as { user?: { id?: string } } | null;
  const id = body?.user?.id;
  if (!id) {
    throw new Error(
      `createWorkspaceNative: no session user (${response.status})`,
    );
  }
  return id;
}

/**
 * Creates a workspace OWNED BY the user behind `cookie`, the way the fixtures always have.
 *
 * Since owner decision D-A (12 Nov 2026) only a current instance administrator may call
 * `POST /api/workspace`, and the request names the owner. This helper therefore makes the
 * caller an instance administrator for the duration of the call, names them as owner, and puts
 * their previous role back afterwards. Nothing else about the world changes: no extra user, no
 * extra person, and the route selects the new workspace and team in the caller's own session
 * exactly as it always did. Concurrent calls for the same user share one elevation.
 *
 * Returns the create response. Tests that assert who may create, or that need a different owner
 * than the caller, use `postCreateWorkspace` instead.
 */
export async function createWorkspaceNative(
  app: App,
  cookie: string,
  body: CreateWorkspaceBody = {},
): Promise<Response> {
  const callerId = await sessionUserId(app, cookie);
  await acquireInstanceAdmin(callerId);
  try {
    return await postCreateWorkspace(app, cookie, {
      ownerUserId: callerId,
      ...body,
    });
  } finally {
    await releaseInstanceAdmin(callerId);
  }
}

export async function updateWorkspaceNative(
  app: App,
  cookie: string,
  workspaceId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

export async function deleteWorkspaceNative(
  app: App,
  cookie: string,
  workspaceId: string,
): Promise<Response> {
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}`,
    {
      method: "DELETE",
      headers: { cookie },
    },
    cookie,
  );
}

/**
 * `DELETE /api/workspace/{id}` only REQUESTS the deletion (202, nothing removed). The
 * requester then approves with the exact workspace name plus step-up. Returns both the
 * request response (status/body of the 202, or a refusal) and, when a pending action was
 * recorded, the approve response, so callers can assert either outcome.
 */
export async function deleteWorkspaceThroughApproval(
  app: App,
  cookie: string,
  workspaceId: string,
  options: { typedName?: string } = {},
) {
  const requested = await deleteWorkspaceNative(app, cookie, workspaceId);
  if (requested.status !== 202) return { requested, approved: undefined };
  const pending = (await requested.clone().json()) as PendingDeletionBody;
  const typedName =
    options.typedName ??
    (
      await db
        .select({ name: schema.workspaceTable.name })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId))
    )[0]?.name;
  const approved = await approvePendingDeletionAsCookie(app, cookie, pending, {
    typedName,
  });
  return { requested, approved, pending };
}
