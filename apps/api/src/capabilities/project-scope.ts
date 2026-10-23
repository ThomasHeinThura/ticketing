import type { Capability } from "@taskdesk/permissions";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { loadProjectAncestorIdsFor } from "../project/hierarchy.repository";
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
    ownerTeamId: null,
  };
  await Promise.all(
    Object.entries(PROJECT_WORK_FLAGS).map(async ([name, capability]) => {
      const key = name as keyof typeof PROJECT_WORK_FLAGS;
      scoped[key] =
        flags[key] === true &&
        hasProjectReadCapability(identity, capability, "work_item", facts);
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
