import type { ResolvedIdentity } from "@taskdesk/permissions";
import type { Executor } from "../database/executor";
import { deleteStorageObject } from "./index";
import {
  deleteAssetsByIds,
  findTaskDescriptionLike,
  listTaskActivityContentsLike,
  listTaskAssetObjectKeys,
  listTaskAssetsByIds,
  listTaskCommentContentsLike,
} from "./repository";

const ASSET_URL_PATTERN = /\/api\/asset\/([a-z0-9]+)/gi;

export function extractAssetIds(
  content: string | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!content) return ids;

  ASSET_URL_PATTERN.lastIndex = 0;
  for (
    let match = ASSET_URL_PATTERN.exec(content);
    match !== null;
    match = ASSET_URL_PATTERN.exec(content)
  ) {
    if (match[1]) ids.add(match[1]);
  }

  return ids;
}

export function contentReferencesAsset(
  content: string | null | undefined,
  assetId: string,
): boolean {
  return extractAssetIds(content).has(assetId);
}

export interface AssetCleanupScope {
  taskId: string;
}

/**
 * Check whether an asset ID is still referenced in any content belonging to
 * the same currently reachable task.
 */
async function isAssetReferencedElsewhere(
  executor: Executor,
  identity: ResolvedIdentity,
  assetId: string,
  taskId: string,
): Promise<boolean> {
  const pattern = `%/api/asset/${assetId}%`;

  const taskRef = await findTaskDescriptionLike(
    executor,
    identity,
    taskId,
    pattern,
  );
  if (contentReferencesAsset(taskRef?.description, assetId)) return true;

  const commentRefs = await listTaskCommentContentsLike(
    executor,
    identity,
    taskId,
    pattern,
  );
  if (commentRefs.some((ref) => contentReferencesAsset(ref.content, assetId))) {
    return true;
  }

  const activityRefs = await listTaskActivityContentsLike(
    executor,
    identity,
    taskId,
    pattern,
  );
  return activityRefs.some((ref) =>
    contentReferencesAsset(ref.content, assetId),
  );
}

/**
 * Clean removed inline assets inside the caller's task/project-locked transaction.
 * Every database statement is run by the supplied executor and rechecks current reach;
 * successful object deletion still precedes deletion of its database row.
 */
export async function deleteOrphanedAssets(
  executor: Executor,
  identity: ResolvedIdentity,
  oldContent: string | null | undefined,
  newContent: string | null | undefined,
  scope: AssetCleanupScope,
): Promise<void> {
  const oldIds = extractAssetIds(oldContent);
  const newIds = extractAssetIds(newContent);
  const removedIds = [...oldIds].filter((id) => !newIds.has(id));
  if (removedIds.length === 0) return;

  const assets = await listTaskAssetsByIds(
    executor,
    identity,
    removedIds,
    scope.taskId,
  );
  const assetsToDelete: typeof assets = [];
  for (const asset of assets) {
    const stillReferenced = await isAssetReferencedElsewhere(
      executor,
      identity,
      asset.id,
      scope.taskId,
    );
    if (!stillReferenced) assetsToDelete.push(asset);
  }

  if (assetsToDelete.length === 0) return;

  const deleteResults = await deleteS3Keys(
    assetsToDelete.map((asset) => asset.objectKey),
  );
  const deletedAssetIds = assetsToDelete
    .filter((_, index) => deleteResults[index]?.status === "fulfilled")
    .map((asset) => asset.id);
  if (deletedAssetIds.length === 0) return;

  await deleteAssetsByIds(executor, identity, deletedAssetIds, scope.taskId);
}

export async function getTaskAssetKeys(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
): Promise<string[]> {
  const assets = await listTaskAssetObjectKeys(executor, identity, taskId);
  return assets.map((asset) => asset.objectKey);
}

export async function deleteS3Keys(
  keys: string[],
): Promise<PromiseSettledResult<void>[]> {
  const deleteResults = await Promise.allSettled(
    keys.map((key) => deleteStorageObject(key)),
  );

  const failedDeletions = keys
    .map((key, index) => ({ key, result: deleteResults[index] }))
    .filter(
      (
        deletion,
      ): deletion is {
        key: string;
        result: PromiseRejectedResult;
      } => deletion.result?.status === "rejected",
    );

  if (failedDeletions.length > 0) {
    console.error(
      "Failed to delete storage objects",
      failedDeletions.map(({ key, result }) => ({
        key,
        reason: result.reason,
      })),
    );
  }

  return deleteResults;
}
