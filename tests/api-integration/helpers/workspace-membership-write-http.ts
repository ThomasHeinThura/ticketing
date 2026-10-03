import { csrfRequest } from "./csrf";
import type { App } from "./organization-http";

// HTTP helpers for the S5 NATIVE membership write routes (issue #6, retrofit
// plan §3, S5 row): add, remove, role-update, leave, transfer-ownership.
// Deliberately separate from `workspace-write-http.ts` (S4) and
// `organization-http.ts` (the frozen S1 oracle's file set), matching that
// same per-stage separation.
//
// Like their siblings these return the raw Response, so callers assert on
// database state and status codes rather than on a response shape.

export async function addWorkspaceMemberNative(
  app: App,
  cookie: string,
  workspaceId: string,
  body: { userId?: unknown; role?: unknown },
): Promise<Response> {
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}/members`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

export async function removeWorkspaceMemberNative(
  app: App,
  cookie: string,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}/members/${userId}`,
    {
      method: "DELETE",
      headers: { cookie },
    },
    cookie,
  );
}

export async function updateWorkspaceMemberRoleNative(
  app: App,
  cookie: string,
  workspaceId: string,
  userId: string,
  body: { role?: unknown },
): Promise<Response> {
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}/members/${userId}/role`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

export async function leaveWorkspaceNative(
  app: App,
  cookie: string,
  workspaceId: string,
): Promise<Response> {
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}/leave`,
    {
      method: "POST",
      headers: { cookie },
    },
    cookie,
  );
}

export async function transferWorkspaceOwnershipNative(
  app: App,
  cookie: string,
  workspaceId: string,
  body: { newOwnerUserId?: unknown },
): Promise<Response> {
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}/transfer-ownership`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    cookie,
  );
}
