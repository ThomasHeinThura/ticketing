import type { App } from "./organization-http";

// HTTP helpers for the S7 NATIVE role list/write routes (issue #6, retrofit
// plan §3, S7 row): list, create, update, delete. Deliberately separate from
// `organization-http.ts` (the frozen S1 oracle's file set, which drives the
// INHERITED plugin routes) and from `workspace-membership-write-http.ts` (S5's
// own routes), matching that same per-stage separation.
//
// Like their siblings these return the raw Response, so callers assert on
// database state and status codes rather than on a response shape.

export async function listWorkspaceRolesNative(
  app: App,
  cookie: string,
  workspaceId: string,
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}/roles`, {
    method: "GET",
    headers: { cookie },
  });
}

export async function createWorkspaceRoleNative(
  app: App,
  cookie: string,
  workspaceId: string,
  body: { role?: unknown; permission?: unknown },
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}/roles`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

export async function updateWorkspaceRoleNative(
  app: App,
  cookie: string,
  workspaceId: string,
  roleId: string,
  body: { permission?: unknown },
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}/roles/${roleId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

export async function deleteWorkspaceRoleNative(
  app: App,
  cookie: string,
  workspaceId: string,
  roleId: string,
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}/roles/${roleId}`, {
    method: "DELETE",
    headers: { cookie },
  });
}
