import type { Capability } from "@taskdesk/permissions";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  loadProjectAncestorIdsFor,
  loadProjectOwnerTeamIdFor,
} from "../project/hierarchy.repository";
import {
  hasProjectReadCapability,
  resolveCallerIdentity,
} from "../utils/has-project-reach";
import {
  assertCallerHasCapability,
  capabilityCredential,
} from "../utils/require-workspace-capability";
import type { CapabilityMap } from "./controllers/get-capabilities";
import { findCapabilityProject } from "./repository";

const PROJECT_WORK_FLAGS = {
  updateTasks: "work_item:update",
  createTasks: "work_item:create",
  createAttachments: "attachment:create",
  deleteTasks: "work_item:delete",
  assignTasks: "work_item:assign",
  transitionTasks: "work_item:transition",
  rankTasks: "work_item:rank",
  exportTasks: "work_item:export",
  setPriorityTasks: "work_item:set_priority",
  createPublicComments: "comment:create",
  createInternalComments: "comment:create_internal",
} as const satisfies Partial<Record<keyof CapabilityMap, Capability>>;

/**
 * Flags whose API is project-scoped rather than work-item-scoped (`budget:read` on
 * `GET /api/projects/{projectId}/budget`): with `?projectId` they follow the project's own grants.
 */
const PROJECT_SCOPE_FLAGS = {
  readBudgets: "budget:read",
} as const satisfies Partial<Record<keyof CapabilityMap, Capability>>;

/** Intersect existing workspace authority with the exact project's effective role. */
export async function scopeWorkCapabilitiesToProject(
  c: Context,
  flags: CapabilityMap,
  projectId: string,
): Promise<CapabilityMap> {
  const identity = await resolveCallerIdentity(c, c.get("userId"));
  if (!identity)
    throw new HTTPException(403, { message: "No access to the workspace" });
  const project = await findCapabilityProject(
    identity,
    c.get("workspaceId"),
    projectId,
  );
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  const scoped = { ...flags };
  // PR-2/PR-3: the flags must equal the server's decision, so authority follows the same
  // ancestor chain the route guards use: with no direct project grant, the nearest ancestor's
  // grant is the override, never the workspace role.
  const facts = {
    ...project,
    ancestorProjectIds: await loadProjectAncestorIdsFor(
      c,
      db,
      identity,
      project.workspaceId,
      project.projectId,
    ),
    ownerTeamId: await loadProjectOwnerTeamIdFor(
      db,
      identity,
      project.workspaceId,
      project.projectId,
    ),
  };
  const entries = [
    ...Object.entries(PROJECT_WORK_FLAGS).map(
      ([name, capability]) =>
        [name, capability, "work_item"] as [string, Capability, "work_item"],
    ),
    ...Object.entries(PROJECT_SCOPE_FLAGS).map(
      ([name, capability]) =>
        [name, capability, "project"] as [string, Capability, "project"],
    ),
  ];
  await Promise.all(
    entries.map(async ([name, capability, scope]) => {
      const key = name as keyof CapabilityMap;
      scoped[key] =
        flags[key] === true &&
        hasProjectReadCapability(identity, capability, scope, facts);
      if (!scoped[key]) return;
      try {
        await assertCallerHasCapability(
          c.get("workspaceId"),
          c.get("userId"),
          capability,
          capabilityCredential(c.get("apiKey")),
        );
      } catch (error) {
        if (!(error instanceof HTTPException) || error.status !== 403)
          throw error;
        scoped[key] = false;
      }
    }),
  );
  return scoped;
}
