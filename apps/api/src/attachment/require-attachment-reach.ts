import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { policyShadowEnabled } from "../permissions/shadow-config";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import {
  projectCapabilityRefused,
  projectReadDecision,
} from "../utils/has-project-reach";
import { isCustomerPrincipal } from "../utils/is-customer-principal";
import {
  WORK_ITEM_REACH_MARK,
  type WorkItemReachMark,
} from "../utils/reach-mark";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import type { WorkItemReachOptions } from "../work-item/require-work-item-reach";
import { findAttachmentWorkItemForReach } from "./repository";

/**
 * `GET /api/attachments/{id}` and `DELETE /api/attachments/{id}` middleware: resolves the
 * caller's workspace reach from the attachment's own id, via a genuine DB lookup, the same
 * shape `work-item/require-work-item-reach.ts` uses for `work_item.key`.
 *
 * This route family handles work-item attachments. Comment/submission parents do not
 * fall through its work-item join and retain their separately scoped routes.
 *
 * Tombstones still resolve for an authorized confirmed no-op. Download independently
 * requires ready state; missing and unreachable resources use the same404 response.
 */
export function requireAttachmentReach(
  idKey = "id",
  options: WorkItemReachOptions = {},
) {
  // PROJECT reach (to the parent work item's project) is the default, exactly as for
  // `requireWorkItemReach()`; workspace-only reach needs a stated reason.
  const projectReach = options.requireProjectReach !== false;
  const middleware = async (c: Context, next: Next) => {
    markShadowLegacyAuthorizationUnknown(c);
    const userId = c.get("userId");
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const id = c.req.param(idKey);
    if (!id) {
      throw new HTTPException(400, { message: "Missing attachment id" });
    }
    if (id.includes("\u0000")) {
      throw new HTTPException(400, { message: "Invalid attachment id" });
    }

    // Same "soft-deleted project freezes its rows" invariant `requireWorkItemReach`
    // enforces for a work item's own key.
    //
    // Issue #480: the work item's OWN `deleted_at`/`archived_at` are checked too, not
    // only its project's -- same gap `require-work-item-reach.ts` closed for #276, here
    // for the attachment-reach path, which has its own local lookup rather than going
    // through that middleware.
    const [row] = await findAttachmentWorkItemForReach(db, id);

    if (!row) {
      throw new HTTPException(404, { message: "Attachment not found" });
    }
    if (!row.projectId || !row.workItemId) {
      throw new HTTPException(404, { message: "Attachment not found" });
    }

    c.set("workspaceId", row.workspaceId);
    c.set("workspaceIdSource", "row");
    c.set("projectId", row.projectId);
    c.set("workItemId", row.workItemId);
    c.set("policyScopeResource", "work_item");
    c.set("policyRowFacts", { personId: row.uploadedBy });
    if (policyShadowEnabled) {
      c.set("projectReachFacts", {
        projectId: row.projectId,
        workspaceId: row.workspaceId,
        organisationId: row.organisationId,
        ancestorProjectIds: [],
        ownerTeamId: null,
      });
    }

    const apiKey = c.get("apiKey");
    try {
      await validateWorkspaceAccess(userId, row.workspaceId, apiKey?.id);
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(404, { message: "Attachment not found" });
      }
      throw error;
    }

    if (projectReach) {
      const decision = await projectReadDecision(c, userId, {
        projectId: row.projectId,
        workspaceId: row.workspaceId,
        organisationId: row.organisationId,
        workItemId: row.workItemId,
        ancestorProjectIds: [],
        ownerTeamId: null,
      });
      if (!decision) {
        throw new HTTPException(500, {
          message: "Project read policy could not be determined",
        });
      }
      if (!decision.reachable) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(404, { message: "Attachment not found" });
      }
      if (
        projectCapabilityRefused(decision, {
          deferCapability: options.deferCapability,
          deferApiKeyCapability: options.deferApiKeyCapability,
          isApiKey: Boolean(apiKey),
        })
      ) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }
      // Customer principals never act through the agent API (matrix: 403 in reach).
      if (await isCustomerPrincipal(userId, row.workspaceId)) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }
    }

    setShadowLegacyAuthorization(c, "allowed");
    return next();
  };
  const mark: WorkItemReachMark = {
    projectReach,
    ...(options.requireProjectReach === false
      ? { workspaceReachOnlyReason: options.workspaceReachOnlyReason }
      : {}),
  };
  return Object.assign(middleware, { [WORK_ITEM_REACH_MARK]: mark });
}

export default requireAttachmentReach;
