import { createHash } from "node:crypto";
import { getRedisPub, isRedisConfigured } from "../redis";

export const SAVED_VIEW_COUNT_TTL_SECONDS = 30;

export function savedViewCountCacheKey(input: {
  viewId: string;
  workspaceId: string;
  scope: string;
  scopeId: string;
  definitionVersion: string;
  query: unknown;
  viewerId: string;
  identity: unknown;
  reachableProjectIds: readonly string[];
  apiKeyId?: string;
}) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        ...input,
        reachableProjectIds: [...input.reachableProjectIds].sort(),
      }),
    )
    .digest("hex");
  return `taskdesk:saved-view-count:v1:${hash}`;
}

/** Cache failures are a performance miss; the authoritative count is still queried. */
export async function getCachedSavedViewCount(
  key: string,
): Promise<number | undefined> {
  if (!isRedisConfigured()) return undefined;
  try {
    const value = await getRedisPub().get(key);
    if (value === null || !/^(?:0|[1-9]\d*)$/u.test(value)) return undefined;
    const count = Number(value);
    return Number.isSafeInteger(count) ? count : undefined;
  } catch {
    return undefined;
  }
}

export async function setCachedSavedViewCount(
  key: string,
  count: number,
): Promise<void> {
  if (!isRedisConfigured()) return;
  try {
    await getRedisPub().set(
      key,
      String(count),
      "EX",
      SAVED_VIEW_COUNT_TTL_SECONDS,
    );
  } catch {
    // Valkey is optional. Do not fail a correct database-backed count on cache errors.
  }
}
