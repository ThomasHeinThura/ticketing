import type { App } from "./organization-http";

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
  return app.request("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "Characterization Workspace",
      ...body,
    }),
  });
}

export async function updateWorkspaceNative(
  app: App,
  cookie: string,
  workspaceId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

export async function deleteWorkspaceNative(
  app: App,
  cookie: string,
  workspaceId: string,
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}`, {
    method: "DELETE",
    headers: { cookie },
  });
}
