import { eq } from "drizzle-orm";
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
};

export async function createWorkspaceNative(
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
