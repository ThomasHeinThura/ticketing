import { and, eq, isNull, not } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { policyShadowEnabled } from "../permissions/shadow-config";
import {
  hasMatchedRowScopedCapabilityPolicy,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import { resolveAssetBearerOrCookie } from "./authenticate-api-request";
import { reachableWorkspacePredicate } from "./workspace-access-middleware";

export type ReachableAsset = {
  id: string;
  objectKey: string;
  mimeType: string;
  filename: string;
  workspaceId: string;
};

/**
 * Loads a stored asset for `GET /api/asset/{id}`, requiring a real
 * credential and folding the workspace-reach check into the same query as
 * the existence lookup.
 *
 * Every caller must present a credential. TaskDesk has no anonymous asset
 * read path: the inherited kaneo branch that returned early for assets of a
 * public project was removed with `project.is_public` in issue #6.
 * `resolveAssetBearerOrCookie` throws 401 before any row is read.
 *
 * #317 S1/S4 (follow-up to #307's S3/S4): this used to run as two steps --
 * fetch the asset row by id alone, then a separate `validateWorkspaceAccess`
 * call remapping its 403 to 404. That left both an existence oracle (closed
 * by #338's S3 round: the remap already masked a foreign asset as "not
 * found") and a timing/query-count residue (an other-tenant id cost three
 * queries against a missing id's one, #338's own S1 finding). Folding
 * `reachableWorkspacePredicate` (`workspace-access-middleware.ts`, exported
 * for exactly this reuse) into the row query itself removes the residue the
 * same way #307/#338's `lookupWorkspaceId` already does for every resource
 * that middleware covers: "missing" and "out of reach" are now the same
 * null row from the same single round trip.
 */
export async function loadReachableAsset(
  c: Context,
  id: string,
): Promise<ReachableAsset> {
  const { userId, apiKeyId } = await resolveAssetBearerOrCookie(c);

  const [asset] = await db
    .select({
      id: schema.assetTable.id,
      objectKey: schema.assetTable.objectKey,
      mimeType: schema.assetTable.mimeType,
      filename: schema.assetTable.filename,
      workspaceId: schema.assetTable.workspaceId,
    })
    .from(schema.assetTable)
    // The join selects nothing now that `is_public` is gone, but it is kept
    // deliberately: it still requires the asset to belong to a real project,
    // so an orphaned asset row 404s rather than being served.
    .innerJoin(
      schema.projectTable,
      eq(schema.assetTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.assetTable.id, id),
        reachableWorkspacePredicate(
          schema.projectTable.workspaceId,
          userId,
          apiKeyId,
        ),
      ),
    )
    .limit(1);

  if (!asset) {
    if (policyShadowEnabled && (await hasMatchedRowScopedCapabilityPolicy(c))) {
      // Evidence-only lookup for this exact asset route. Keep the native 404
      // unless a live, non-orphaned row is proven to have failed the same reach
      // predicate used by the primary load above.
      try {
        const [deniedAsset] = await db
          .select({ workspaceId: schema.assetTable.workspaceId })
          .from(schema.assetTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.assetTable.projectId, schema.projectTable.id),
          )
          .where(
            and(
              eq(schema.assetTable.id, id),
              isNull(schema.projectTable.deletedAt),
              not(
                reachableWorkspacePredicate(
                  schema.projectTable.workspaceId,
                  userId,
                  apiKeyId,
                ),
              ),
            ),
          )
          .limit(1);
        if (deniedAsset) {
          setShadowLegacyAuthorization(c, "denied");
          c.set("workspaceId", deniedAsset.workspaceId);
          c.set("workspaceIdSource", "row");
        }
      } catch {
        // Observer failure leaves the native masked response untouched.
      }
    }
    throw new HTTPException(404, { message: "Asset not found" });
  }

  return asset;
}
