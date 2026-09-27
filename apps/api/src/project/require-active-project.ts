import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable } from "../database/schema";

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
  const [project] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, id),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }
}
