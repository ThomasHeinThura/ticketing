import { expect } from "vitest";
import { csrfRequest } from "./csrf";
import type { App } from "./organization-http";
import {
  approvePendingDeletionAsCookie,
  type PendingDeletionBody,
} from "./pending-deletion";
import { type StepUpOption, stepUpHeaders } from "./step-up";

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
  body: {
    role?: unknown;
    permission?: unknown;
    capabilities?: unknown;
    description?: unknown;
    rank?: unknown;
    cloneFromRoleId?: unknown;
  },
  stepUp?: StepUpOption,
): Promise<Response> {
  // Elevated: the route spends a one-use proof bound to exactly this body.
  const proof = await stepUpHeaders(
    app,
    cookie,
    stepUp,
    "workspace_role_create",
    {
      workspaceId,
      ...body,
    },
  );
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}/roles`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...proof },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

export async function updateWorkspaceRoleNative(
  app: App,
  cookie: string,
  workspaceId: string,
  roleId: string,
  body: {
    permission?: unknown;
    capabilities?: unknown;
    name?: unknown;
    description?: unknown;
    rank?: unknown;
    expectedVersion?: unknown;
    confirmSelfEdit?: unknown;
  },
  stepUp?: StepUpOption,
): Promise<Response> {
  // `confirmSelfEdit` only acknowledges a warning and is not part of the proof binding.
  const { confirmSelfEdit: _confirm, ...bound } = body;
  const proof = await stepUpHeaders(
    app,
    cookie,
    stepUp,
    "workspace_role_update",
    {
      workspaceId,
      roleId,
      ...bound,
    },
  );
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}/roles/${roleId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, ...proof },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

export async function deleteWorkspaceRoleNative(
  app: App,
  cookie: string,
  workspaceId: string,
  roleId: string,
): Promise<Response> {
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}/roles/${roleId}`,
    {
      method: "DELETE",
      headers: { cookie },
    },
    cookie,
  );
}

/** Role deletion only REQUESTS (202); the row survives until `approveWorkspaceRoleDeletion`. */
export async function requestWorkspaceRoleDeletion(
  app: App,
  cookie: string,
  workspaceId: string,
  roleId: string,
): Promise<PendingDeletionBody> {
  const response = await deleteWorkspaceRoleNative(
    app,
    cookie,
    workspaceId,
    roleId,
  );
  expect(response.status, await response.clone().text()).toBe(202);
  return (await response.json()) as PendingDeletionBody;
}

/** Click approval of a pending role deletion; returns the raw approve response. */
export function approveWorkspaceRoleDeletion(
  app: App,
  cookie: string,
  pending: PendingDeletionBody,
): Promise<Response> {
  return approvePendingDeletionAsCookie(app, cookie, pending);
}

export async function getWorkspaceRoleNative(
  app: App,
  cookie: string,
  workspaceId: string,
  roleId: string,
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}/roles/${roleId}`, {
    method: "GET",
    headers: { cookie },
  });
}

export async function listWorkspaceRoleHoldersNative(
  app: App,
  cookie: string,
  workspaceId: string,
  roleId: string,
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}/roles/${roleId}/holders`, {
    method: "GET",
    headers: { cookie },
  });
}

export async function getWorkspaceRoleHistoryNative(
  app: App,
  cookie: string,
  workspaceId: string,
  roleId: string,
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}/roles/${roleId}/history`, {
    method: "GET",
    headers: { cookie },
  });
}

export async function previewWorkspaceRoleNative(
  app: App,
  cookie: string,
  workspaceId: string,
  roleId: string,
  body: { capabilities: unknown },
): Promise<Response> {
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}/roles/${roleId}/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

export async function reassignWorkspaceRoleNative(
  app: App,
  cookie: string,
  workspaceId: string,
  roleId: string,
  body: { toRoleId?: unknown; userIds?: unknown },
): Promise<Response> {
  return csrfRequest(
    app,
    `/api/workspace/${workspaceId}/roles/${roleId}/reassign`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    cookie,
  );
}
