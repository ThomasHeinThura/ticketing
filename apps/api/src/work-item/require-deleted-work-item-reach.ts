import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { policyShadowEnabled } from "../permissions/shadow-config";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import {
  loadProjectAncestorIdsForRequest,
  loadProjectOwnerTeamId,
} from "../project/hierarchy.repository";
import {
  projectCapabilityRefused,
  projectReadDecision,
} from "../utils/has-project-reach";
import { isCustomerPrincipal } from "../utils/is-customer-principal";
import { WORK_ITEM_REACH_MARK } from "../utils/reach-mark";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

/**
 * Recovery-only lookup. Ordinary work-item routes continue to use
 * `requireWorkItemReach`, which rejects both archived and deleted rows.
 */
export function requireDeletedWorkItemReach(idKey = "key") {
  const middleware = async (c: Context, next: Next) => {
    markShadowLegacyAuthorizationUnknown(c);
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
    const key = c.req.param(idKey);
    if (!key)
      throw new HTTPException(400, { message: "Missing work item key" });
    if (key.includes("\u0000"))
      throw new HTTPException(400, { message: "Invalid work item key" });

    const [row] = await db
      .select({
        id: schema.workItemTable.id,
        projectId: schema.workItemTable.projectId,
        workspaceId: schema.workItemTable.workspaceId,
        organisationId: schema.workspaceTable.organisationId,
      })
      .from(schema.workItemTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.projectTable.id, schema.workItemTable.projectId),
      )
      .innerJoin(
        schema.workspaceTable,
        eq(schema.workspaceTable.id, schema.workItemTable.workspaceId),
      )
      .where(
        and(
          eq(schema.workItemTable.key, key),
          isNotNull(schema.workItemTable.deletedAt),
          isNull(schema.projectTable.deletedAt),
          isNull(schema.projectTable.archivedAt),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Work item not found" });

    c.set("workspaceId", row.workspaceId);
    c.set("workspaceIdSource", "row");
    c.set("workItemId", row.id);
    c.set("projectId", row.projectId);
    c.set("policyScopeResource", "work_item");
    const ancestorProjectIds = await loadProjectAncestorIdsForRequest(
      c,
      db,
      row.workspaceId,
      row.projectId,
    );
    const ownerTeamId = await loadProjectOwnerTeamId(
      db,
      row.workspaceId,
      row.projectId,
    );
    const facts = {
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      organisationId: row.organisationId,
      ancestorProjectIds,
      ownerTeamId,
      workItemId: row.id,
    };
    if (policyShadowEnabled) c.set("projectReachFacts", facts);

    const apiKey = c.get("apiKey");
    try {
      await validateWorkspaceAccess(userId, row.workspaceId, apiKey?.id);
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(404, { message: "Work item not found" });
      }
      throw error;
    }
    const decision = await projectReadDecision(c, userId, facts);
    if (!decision)
      throw new HTTPException(500, {
        message: "Project read policy could not be determined",
      });
    if (!decision.reachable) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(404, { message: "Work item not found" });
    }
    if (
      projectCapabilityRefused(decision, {
        deferApiKeyCapability: true,
        isApiKey: Boolean(apiKey),
      })
    ) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    if (await isCustomerPrincipal(userId, row.workspaceId)) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    setShadowLegacyAuthorization(c, "allowed");
    await next();
  };
  return Object.assign(middleware, {
    [WORK_ITEM_REACH_MARK]: { projectReach: true } as const,
  });
}
