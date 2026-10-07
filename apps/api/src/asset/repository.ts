import { eq } from "drizzle-orm";
import db, { schema } from "../database";

export type AssetWorkspaceScope = {
  readonly workspaceId: string;
  readonly projectWorkspaceId: string;
};

export async function findAssetWorkspaceScope(
  assetId: string,
): Promise<AssetWorkspaceScope | null> {
  const [asset] = await db
    .select({
      workspaceId: schema.assetTable.workspaceId,
      projectWorkspaceId: schema.projectTable.workspaceId,
    })
    .from(schema.assetTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.assetTable.projectId, schema.projectTable.id),
    )
    .where(eq(schema.assetTable.id, assetId))
    .limit(1);

  return asset ?? null;
}
