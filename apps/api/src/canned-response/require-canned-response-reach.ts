import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { policyShadowEnabled } from "../permissions/shadow-config";
import {
  evaluateProjectRead,
  projectCapabilityRefused,
  resolveCallerIdentity,
} from "../utils/has-project-reach";
import { isCustomerPrincipal } from "../utils/is-customer-principal";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { cannedResponsePolicies } from "./policy";
import {
  findCannedResponseWorkItem,
  findCannedResponseWorkspaceId,
} from "./repository";

export function requireCannedResponseListReach() {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
    const workItemKey = c.req.query("workItemKey");
    if (!workItemKey || workItemKey.includes("\u0000")) {
      throw new HTTPException(400, { message: "Invalid work item key" });
    }
    const identity = await resolveCallerIdentity(c, userId);
    if (!identity) throw new HTTPException(401, { message: "Unauthorized" });
    const target = await findCannedResponseWorkItem(identity, workItemKey);
    if (!target)
      throw new HTTPException(404, { message: "Work item not found" });
    c.set("workspaceId", target.workspaceId);
    c.set("workspaceIdSource", "row");
    c.set("workItemId", target.id);
    c.set("projectId", target.projectId);
    c.set("policyScopeResource", "work_item");
    if (policyShadowEnabled) {
      c.set("projectReachFacts", {
        projectId: target.projectId,
        workspaceId: target.workspaceId,
        organisationId: target.organisationId,
        workItemId: target.id,
        ancestorProjectIds: [],
        ownerTeamId: null,
      });
    }
    const policy = cannedResponsePolicies["GET /api/canned-responses"];
    const decision = evaluateProjectRead(
      identity,
      policy.capability,
      policy.scope,
      {
        projectId: target.projectId,
        workspaceId: target.workspaceId,
        organisationId: target.organisationId,
        workItemId: target.id,
        ancestorProjectIds: [],
        ownerTeamId: null,
      },
    );
    if (!decision?.reachable)
      throw new HTTPException(404, { message: "Work item not found" });
    if (
      projectCapabilityRefused(decision, { isApiKey: Boolean(c.get("apiKey")) })
    ) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    if (await isCustomerPrincipal(userId, target.workspaceId)) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    return next();
  };
}

/**
 * `PATCH|DELETE /api/canned-responses/{id}` middleware -- resolves the row's own
 * `workspace_id` by a genuine DB lookup and requires membership in it. Local middleware,
 * not an addition to `workspace-access-middleware.ts`'s closed `resource` union -- same
 * partition-by-file reasoning `work-item/require-comment-reach.ts` gives for its own
 * local middleware. Missing row and out-of-reach row both answer 404 (issue #290's
 * precedent).
 */
export function requireCannedResponseReach(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const id = c.req.param(idKey);
    if (!id) {
      throw new HTTPException(400, { message: "Missing canned response id" });
    }
    rejectNulByte(id, "Canned response id");

    const identity = await resolveCallerIdentity(c, userId);
    if (!identity) throw new HTTPException(401, { message: "Unauthorized" });
    const row = await findCannedResponseWorkspaceId(identity, id);

    if (!row) {
      throw new HTTPException(404, { message: "Canned response not found" });
    }

    const apiKey = c.get("apiKey");
    try {
      await validateWorkspaceAccess(userId, row.workspaceId, apiKey?.id);
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        throw new HTTPException(404, { message: "Canned response not found" });
      }
      throw error;
    }

    c.set("workspaceId", row.workspaceId);
    // #400 F1 (Opus review): this id is read straight from the canned response's own
    // row, never from the caller's request -- label it so shadow mode's evidence gate
    // (`workspaceIdForShadowEvidence`, `shadow-context.ts`) keeps it instead of always
    // nulling it, the same as every other row-derived source already does.
    c.set("workspaceIdSource", "row");
    return next();
  };
}
