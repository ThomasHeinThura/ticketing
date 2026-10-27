import { HTTPException } from "hono/http-exception";
import type { Executor } from "../database/executor";
import { readOrganisationStorageUsage } from "./repository";

export const STORAGE_QUOTA_MESSAGE =
  "The organisation storage limit has been reached. Delete files or ask an administrator to raise the limit.";

/**
 * P1 attachment limit "Total per organisation" (`organisation_quota.max_storage_bytes`,
 * default 20 GiB). `data-model.md`: exceeding a limit returns 429. Call inside the same
 * transaction as the pending-row insert (the helper takes the per-organisation advisory lock)
 * so two concurrent presigns cannot both pass the check.
 */
export async function assertOrganisationStorageQuota(
  executor: Executor,
  input: {
    workspaceId: string;
    additionalBytes: number;
    excludeAttachmentId?: string;
  },
) {
  const usage = await readOrganisationStorageUsage(executor, {
    workspaceId: input.workspaceId,
    lock: true,
    ...(input.excludeAttachmentId
      ? { excludeAttachmentId: input.excludeAttachmentId }
      : {}),
  });
  if (!usage) return;
  if (usage.usedBytes + input.additionalBytes > usage.maxStorageBytes) {
    throw new HTTPException(429, { message: STORAGE_QUOTA_MESSAGE });
  }
}
