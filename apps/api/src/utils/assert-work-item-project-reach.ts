import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { projectReadDecision } from "./has-project-reach";
import { isCustomerPrincipal } from "./is-customer-principal";

/**
 * Project reach for a route whose own middleware already resolved the addressed row
 * (task relation, comment by id). Same decision the other reach middleware makes: 404 with
 * the caller-supplied "not found" message outside reach (byte-identical to a missing row),
 * 403 in reach without the registered capability (unless deferred to a key-aware downstream
 * gate for API keys), and 403 for customer principals.
 */
export async function assertWorkItemProjectReach(
  c: Context,
  userId: string,
  facts: {
    readonly projectId: string;
    readonly workspaceId: string;
    readonly workItemId: string;
  },
  options: {
    readonly notFoundMessage: string;
    readonly deferApiKeyCapability?: boolean;
  },
): Promise<void> {
  const [workspace] = await db
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, facts.workspaceId))
    .limit(1);
  const decision = await projectReadDecision(c, userId, {
    projectId: facts.projectId,
    workspaceId: facts.workspaceId,
    organisationId: workspace?.organisationId ?? null,
    workItemId: facts.workItemId,
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
    throw new HTTPException(404, { message: options.notFoundMessage });
  }
  if (
    !decision.capable &&
    !(options.deferApiKeyCapability === true && c.get("apiKey"))
  ) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
  if (await isCustomerPrincipal(userId, facts.workspaceId)) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
}
