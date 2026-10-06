import { HTTPException } from "hono/http-exception";
import { getActiveProjectIdQuery } from "./repository";

/**
 * Shared existence check for issue #25's project sub-resource routes (stakeholders,
 * milestones, prerequisites, document links). `workspaceAccess.fromProject()`
 * (`utils/workspace-access-middleware.ts`) only resolves reach -- its own `"project"`
 * lookup case carries no `isNull(deletedAt)` filter, so a soft-deleted project is still
 * reachable through it. Every existing project mutation controller (`archive-project.ts`,
 * `update-project.ts`, `delete-project.ts`) re-checks existence and excludes a
 * soft-deleted row itself; this is that same check, shared so ~16 new sub-resource
 * controllers don't each reimplement it.
 */
export async function requireActiveProject(id: string, workspaceId: string) {
  const [project] = await getActiveProjectIdQuery(id, workspaceId);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }
}
