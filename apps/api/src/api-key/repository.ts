import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import db from "../database";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  apiKeyExtensionTable,
  apikeyTable,
  personTable,
} from "../database/schema";
import { type ApiKeyKind, legacyPersonalKeyKind } from "./credential";

export async function loadApiKeyKind(
  apiKeyId: string,
  executor?: Executor,
): Promise<ApiKeyKind> {
  const [row] = await executorOrDefault(executor)
    .select({
      workspaceId: apiKeyExtensionTable.workspaceId,
      personId: apiKeyExtensionTable.personId,
      isMcp: apiKeyExtensionTable.isMcp,
      ipAllowlist: apiKeyExtensionTable.ipAllowlist,
      rateLimitPerMinute: apiKeyExtensionTable.rateLimitPerMinute,
      disabledAt: apiKeyExtensionTable.disabledAt,
      capabilities: apiKeyExtensionTable.capabilities,
    })
    .from(apiKeyExtensionTable)
    .where(eq(apiKeyExtensionTable.apikeyId, apiKeyId))
    .limit(1);
  if (!row) return legacyPersonalKeyKind(apiKeyId);
  return {
    id: apiKeyId,
    kind: row.workspaceId ? "service" : "personal",
    isMcp: row.isMcp,
    workspaceId: row.workspaceId,
    personId: row.personId,
    ipAllowlist: row.ipAllowlist,
    rateLimitPerMinute: row.rateLimitPerMinute,
    disabledAt: row.disabledAt,
    // Malformed storage grants nothing: only an array of strings counts.
    capabilities:
      Array.isArray(row.capabilities) &&
      row.capabilities.every((entry) => typeof entry === "string")
        ? [...row.capabilities]
        : null,
  };
}

const LAST_USED_WRITE_INTERVAL_SECONDS = 60;

/**
 * AK-5: record the last-used time and IP for an authenticated key request. The write is
 * throttled to once a minute per key (a conditional update, so a busy agent does not turn
 * every request into a row write) and never throws into the request path.
 */
export async function recordApiKeyUse(
  apiKeyId: string,
  clientIp: string | null,
): Promise<void> {
  try {
    await db
      .update(apiKeyExtensionTable)
      .set({ lastUsedAt: sql`now()`, lastUsedIp: clientIp })
      .where(
        and(
          eq(apiKeyExtensionTable.apikeyId, apiKeyId),
          or(
            isNull(apiKeyExtensionTable.lastUsedAt),
            sql`${apiKeyExtensionTable.lastUsedAt} < now() - make_interval(secs => ${LAST_USED_WRITE_INTERVAL_SECONDS})`,
            sql`${apiKeyExtensionTable.lastUsedIp} IS DISTINCT FROM ${clientIp}`,
          ),
        ),
      );
    await db
      .update(apikeyTable)
      .set({ lastRequest: sql`now()` })
      .where(
        and(
          eq(apikeyTable.id, apiKeyId),
          or(
            isNull(apikeyTable.lastRequest),
            sql`${apikeyTable.lastRequest} < now() - make_interval(secs => ${LAST_USED_WRITE_INTERVAL_SECONDS})`,
          ),
        ),
      );
  } catch {
    // Observability only: a failed last-used write must never fail an authenticated request.
  }
}

/* ------------------------------------------------------------------ *
 * Issuance, listing and revocation
 * ------------------------------------------------------------------ */

export type StoredApiKey = {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  permissions: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  isMcp: boolean;
  workspaceId: string | null;
  personId: string | null;
  capabilities: string[] | null;
  ipAllowlist: string[] | null;
  rateLimitPerMinute: number | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  disabledAt: Date | null;
  disabledReason: string | null;
  creatorActive: boolean | null;
};

const storedKeyColumns = {
  id: apikeyTable.id,
  name: apikeyTable.name,
  prefix: apikeyTable.prefix,
  start: apikeyTable.start,
  enabled: apikeyTable.enabled,
  permissions: apikeyTable.permissions,
  expiresAt: apikeyTable.expiresAt,
  createdAt: apikeyTable.createdAt,
  lastRequest: apikeyTable.lastRequest,
  isMcp: apiKeyExtensionTable.isMcp,
  workspaceId: apiKeyExtensionTable.workspaceId,
  personId: apiKeyExtensionTable.personId,
  capabilities: apiKeyExtensionTable.capabilities,
  ipAllowlist: apiKeyExtensionTable.ipAllowlist,
  rateLimitPerMinute: apiKeyExtensionTable.rateLimitPerMinute,
  lastUsedAt: apiKeyExtensionTable.lastUsedAt,
  lastUsedIp: apiKeyExtensionTable.lastUsedIp,
  disabledAt: apiKeyExtensionTable.disabledAt,
  disabledReason: apiKeyExtensionTable.disabledReason,
  creatorActive: personTable.active,
};

/**
 * Every key joined to its (optional) extension row. A key with no extension row is a legacy
 * personal key: `is_mcp`, owner and the rest come back null and read as the defaults.
 */
function keySelect(executor: Executor) {
  return executor
    .select(storedKeyColumns)
    .from(apikeyTable)
    .leftJoin(
      apiKeyExtensionTable,
      eq(apiKeyExtensionTable.apikeyId, apikeyTable.id),
    )
    .leftJoin(
      personTable,
      eq(personTable.id, apiKeyExtensionTable.createdByPersonId),
    );
}

function toStored(
  row: Awaited<ReturnType<typeof listRaw>>[number],
): StoredApiKey {
  return {
    ...row,
    enabled: row.enabled ?? false,
    isMcp: row.isMcp ?? false,
    workspaceId: row.workspaceId ?? null,
    personId: row.personId ?? null,
    capabilities: row.capabilities ?? null,
    ipAllowlist: row.ipAllowlist ?? null,
    rateLimitPerMinute: row.rateLimitPerMinute ?? null,
    lastUsedAt: row.lastUsedAt ?? row.lastRequest ?? null,
    lastUsedIp: row.lastUsedIp ?? null,
    disabledAt: row.disabledAt ?? null,
    disabledReason: row.disabledReason ?? null,
    creatorActive: row.creatorActive ?? null,
  };
}

function listRaw(executor: Executor, where: SQL | undefined) {
  return keySelect(executor).where(where).orderBy(desc(apikeyTable.createdAt));
}

function personalKeyOwnedBy(userId: string) {
  return and(
    or(eq(apikeyTable.userId, userId), eq(apikeyTable.referenceId, userId)),
    // A service key is never a person's key even if a stray user id were stored on it.
    isNull(apiKeyExtensionTable.workspaceId),
  );
}

export async function listKeysForUser(
  userId: string,
  executor?: Executor,
): Promise<StoredApiKey[]> {
  const rows = await listRaw(
    executorOrDefault(executor),
    personalKeyOwnedBy(userId),
  );
  return rows.map(toStored);
}

export async function listKeysForWorkspace(
  workspaceId: string,
  executor?: Executor,
): Promise<StoredApiKey[]> {
  const rows = await listRaw(
    executorOrDefault(executor),
    eq(apiKeyExtensionTable.workspaceId, workspaceId),
  );
  return rows.map(toStored);
}

export async function findKeyForUser(
  executor: Executor,
  keyId: string,
  userId: string,
): Promise<StoredApiKey | undefined> {
  const [row] = await listRaw(
    executor,
    and(eq(apikeyTable.id, keyId), personalKeyOwnedBy(userId)),
  ).limit(1);
  return row ? toStored(row) : undefined;
}

export async function findKeyForWorkspace(
  executor: Executor,
  keyId: string,
  workspaceId: string,
): Promise<StoredApiKey | undefined> {
  const [row] = await listRaw(
    executor,
    and(
      eq(apikeyTable.id, keyId),
      eq(apiKeyExtensionTable.workspaceId, workspaceId),
    ),
  ).limit(1);
  return row ? toStored(row) : undefined;
}

export type NewApiKey = {
  id: string;
  name: string;
  prefix: string;
  start: string;
  hashedKey: string;
  /** null for a service key: no person, no user behind it. */
  userId: string | null;
  permissions: Record<string, string[]>;
  expiresAt: Date | null;
  rateLimitPerMinute: number | null;
  extension: {
    workspaceId: string | null;
    personId: string | null;
    createdByPersonId: string;
    capabilities: string[] | null;
    ipAllowlist: string[] | null;
    isMcp: boolean;
  };
};

export async function insertApiKey(
  executor: Executor,
  input: NewApiKey,
): Promise<void> {
  const now = new Date();
  await executor.insert(apikeyTable).values({
    id: input.id,
    configId: "default",
    name: input.name,
    start: input.start,
    prefix: input.prefix,
    key: input.hashedKey,
    userId: input.userId,
    referenceId: input.userId,
    enabled: true,
    rateLimitEnabled: true,
    rateLimitTimeWindow: 60_000,
    rateLimitMax: input.rateLimitPerMinute ?? 100,
    requestCount: 0,
    expiresAt: input.expiresAt,
    createdAt: now,
    updatedAt: now,
    permissions: JSON.stringify(input.permissions),
  });
  await executor.insert(apiKeyExtensionTable).values({
    apikeyId: input.id,
    workspaceId: input.extension.workspaceId,
    personId: input.extension.personId,
    createdByPersonId: input.extension.createdByPersonId,
    capabilities: input.extension.capabilities,
    ipAllowlist: input.extension.ipAllowlist,
    rateLimitPerMinute: input.rateLimitPerMinute,
    isMcp: input.extension.isMcp,
  });
}

/** Row lock on the key being revoked or deleted, so two revocations serialise. */
export async function lockApiKey(executor: Executor, keyId: string) {
  await executor
    .select({ id: apikeyTable.id })
    .from(apikeyTable)
    .where(eq(apikeyTable.id, keyId))
    .for("update");
}

/** AK-6: revocation is immediate and keeps the row (it is not a deletion). */
export async function disableApiKey(
  executor: Executor,
  keyId: string,
  reason: string,
): Promise<boolean> {
  const [disabled] = await executor
    .update(apikeyTable)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(apikeyTable.id, keyId))
    .returning({ id: apikeyTable.id });
  if (!disabled) return false;
  await executor
    .update(apiKeyExtensionTable)
    .set({ disabledAt: sql`now()`, disabledReason: reason })
    .where(
      and(
        eq(apiKeyExtensionTable.apikeyId, keyId),
        isNull(apiKeyExtensionTable.disabledAt),
      ),
    );
  return true;
}

export async function findPersonIdForUser(
  userId: string,
  executor?: Executor,
): Promise<string | undefined> {
  const [row] = await executorOrDefault(executor)
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
  return row?.id;
}

/** The locked service-key row a deletion request or approval works from (AK-11). */
export async function loadServiceKeyForDeletion(
  executor: Executor,
  keyId: string,
) {
  const [row] = await executor
    .select({
      id: apikeyTable.id,
      name: apikeyTable.name,
      enabled: apikeyTable.enabled,
      expiresAt: apikeyTable.expiresAt,
      workspaceId: apiKeyExtensionTable.workspaceId,
      capabilities: apiKeyExtensionTable.capabilities,
      ipAllowlist: apiKeyExtensionTable.ipAllowlist,
      disabledAt: apiKeyExtensionTable.disabledAt,
    })
    .from(apikeyTable)
    .innerJoin(
      apiKeyExtensionTable,
      eq(apiKeyExtensionTable.apikeyId, apikeyTable.id),
    )
    .where(
      and(
        eq(apikeyTable.id, keyId),
        isNotNull(apiKeyExtensionTable.workspaceId),
      ),
    )
    .for("update", { of: apikeyTable })
    .limit(1);
  return row;
}

export async function deleteApiKeyRow(
  executor: Executor,
  keyId: string,
): Promise<boolean> {
  const [deleted] = await executor
    .delete(apikeyTable)
    .where(eq(apikeyTable.id, keyId))
    .returning({ id: apikeyTable.id });
  return deleted !== undefined;
}
