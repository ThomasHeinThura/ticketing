import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import type { StepUpSpender } from "../auth/step-up-spend";
import db from "../database";
import {
  decryptIdentityClientSecret,
  encryptIdentityClientSecret,
} from "../identity/client-secret";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import {
  lockS3Draft,
  persistS3Draft,
  readS3Draft,
  S3_DRAFT_INSTANCE_KEY,
  S3_DRAFT_PLUGIN_ID,
} from "./s3-draft-repository";
import {
  resolveS3DraftEndpoint,
  type S3DraftConfig,
  type S3DraftCredentialChanges,
  type S3DraftCredentials,
  type S3DraftProbeCandidate,
  type S3DraftStoredCredentials,
  type S3DraftWrite,
  s3DraftConfigSchema,
  s3DraftCredentialsSchema,
  s3DraftProbeCandidateSchema,
  s3DraftStoredCredentialsSchema,
  s3DraftWriteSchema,
} from "./s3-draft-schema";

export type S3DraftActor = {
  userId: string;
  personId: string;
  traceId?: string;
};
type DraftRow = NonNullable<Awaited<ReturnType<typeof readS3Draft>>>;
export type S3DraftResponse = {
  version: number;
  config: S3DraftConfig | null;
  credentialConfigured: boolean;
  accessKeyIdConfigured: boolean;
  secretAccessKeyConfigured: boolean;
};

/** Internal only: this value contains decrypted credentials and must not be serialized. */
export type S3DraftProbeSelection = {
  version: number;
  config: Readonly<S3DraftConfig>;
  credentials: Readonly<S3DraftCredentials>;
};

function validateStoredRow(row: DraftRow): S3DraftConfig {
  const parsed = s3DraftConfigSchema.safeParse(row.config);
  if (
    !parsed.success ||
    row.enabled ||
    row.scope !== "instance" ||
    row.workspaceId !== null ||
    row.portalScope !== null
  )
    throw new HTTPException(503, { message: "S3 draft unavailable" });
  return parsed.data;
}

function responseFor(row: DraftRow): S3DraftResponse {
  const credentials = readCredentials(row);
  return {
    version: row.configVersion,
    config: validateStoredRow(row),
    credentialConfigured:
      !!credentials.accessKeyId && !!credentials.secretAccessKey,
    accessKeyIdConfigured: !!credentials.accessKeyId,
    secretAccessKeyConfigured: !!credentials.secretAccessKey,
  };
}

function readCredentials(row: DraftRow | undefined): S3DraftStoredCredentials {
  if (!row?.secrets) return {};
  try {
    return s3DraftStoredCredentialsSchema.parse(
      JSON.parse(decryptIdentityClientSecret(row.id, row.secrets)),
    );
  } catch {
    throw new HTTPException(503, { message: "S3 draft unavailable" });
  }
}

function mergeCredentials(
  existing: S3DraftStoredCredentials,
  changes: S3DraftCredentialChanges | null | undefined,
): S3DraftStoredCredentials {
  if (changes === null) return {};
  const merged = {
    accessKeyId:
      changes?.accessKeyId === undefined
        ? existing.accessKeyId
        : (changes.accessKeyId ?? undefined),
    secretAccessKey:
      changes?.secretAccessKey === undefined
        ? existing.secretAccessKey
        : (changes.secretAccessKey ?? undefined),
  };
  return s3DraftStoredCredentialsSchema.parse(merged);
}

function assertDestinationCredentialSafety(
  previousConfig: S3DraftConfig | null,
  config: S3DraftConfig,
  changes: S3DraftCredentialChanges | null | undefined,
) {
  if (
    !previousConfig ||
    resolveS3DraftEndpoint(previousConfig) === resolveS3DraftEndpoint(config)
  )
    return;
  if (
    !(
      typeof changes?.accessKeyId === "string" &&
      typeof changes.secretAccessKey === "string"
    )
  )
    throw new HTTPException(400, {
      message: "Fresh S3 credentials required for a changed endpoint",
    });
}

function encryptDraftCredentials(
  id: string,
  credentials: S3DraftStoredCredentials,
): Buffer {
  try {
    return encryptIdentityClientSecret(id, JSON.stringify(credentials));
  } catch {
    throw new HTTPException(503, {
      message: "S3 credential storage unavailable",
    });
  }
}

export async function getS3Draft(): Promise<S3DraftResponse> {
  const row = await readS3Draft();
  return row
    ? responseFor(row)
    : {
        version: 0,
        config: null,
        credentialConfigured: false,
        accessKeyIdConfigured: false,
        secretAccessKeyConfigured: false,
      };
}

export async function saveS3Draft(
  input: S3DraftWrite,
  actor: S3DraftActor,
  spend: StepUpSpender,
): Promise<S3DraftResponse> {
  const parsed = s3DraftWriteSchema.safeParse(input);
  if (!parsed.success)
    throw new HTTPException(400, { message: "Invalid S3 draft" });
  const value = parsed.data;
  let auditFailed = false;
  const saved = await db.transaction(async (tx) => {
    const existing = await lockS3Draft(tx);
    if ((existing?.configVersion ?? 0) !== value.version)
      throw new HTTPException(409, { message: "version_conflict" });
    const previousConfig = existing ? validateStoredRow(existing) : null;
    const previousCredentials = readCredentials(existing);
    assertDestinationCredentialSafety(
      previousConfig,
      value.config,
      value.credentials,
    );
    const mergedCredentials = mergeCredentials(
      previousCredentials,
      value.credentials,
    );
    const id = existing?.id ?? createId();
    const secrets =
      value.credentials === undefined
        ? (existing?.secrets ?? null)
        : mergedCredentials.accessKeyId || mergedCredentials.secretAccessKey
          ? encryptDraftCredentials(id, mergedCredentials)
          : null;
    await spend(tx);
    const row = await persistS3Draft(
      tx,
      {
        id,
        pluginId: S3_DRAFT_PLUGIN_ID,
        instanceKey: S3_DRAFT_INSTANCE_KEY,
        displayName: "S3 draft",
        enabled: false,
        config: value.config,
        secrets,
        scope: "instance",
        workspaceId: null,
        portalScope: null,
        configVersion: value.version + 1,
        updatedBy: actor.personId,
        updatedAt: new Date(),
      },
      value.version,
    );
    if (!row) throw new HTTPException(409, { message: "version_conflict" });
    try {
      await appendAuditLog(tx, {
        action: "plugin.changed",
        actorId: actor.userId,
        actorType: "person",
        entityType: "instance_plugin_config",
        entityId: id,
        workspaceId: null,
        traceId: actor.traceId,
        after: {
          changedKeys: [
            ...Object.keys(value.config).filter((key) => {
              const field = key as keyof typeof value.config;
              return (
                previousConfig === null ||
                (previousConfig as unknown as Record<string, unknown>)[
                  field
                ] !==
                  (value.config as unknown as Record<string, unknown>)[field]
              );
            }),
            ...(value.credentials === null
              ? ["credentials"]
              : Object.keys(value.credentials ?? {}).filter(
                  (key) =>
                    value.credentials?.[
                      key as keyof S3DraftCredentialChanges
                    ] !== undefined,
                )),
          ],
        },
      });
    } catch {
      auditFailed = true;
    }
    return responseFor(row);
  });
  if (auditFailed) {
    recordAuditWriteFailure("mutation");
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }
  return saved;
}

/**
 * Reserve the test audit and rate limit before releasing a frozen draft to a
 * caller. This function does no networking and never changes the active driver.
 */
export async function selectS3DraftForProbe(
  input: S3DraftProbeCandidate,
  actor: S3DraftActor,
  spend: StepUpSpender,
): Promise<S3DraftProbeSelection> {
  const candidate = s3DraftProbeCandidateSchema.safeParse(input);
  if (!candidate.success)
    throw new HTTPException(400, { message: "Invalid S3 draft" });
  const proposed = candidate.data;
  const version = proposed.version;
  const selected = await db.transaction(async (tx) => {
    const row = await lockS3Draft(tx);
    if ((row?.configVersion ?? 0) !== version)
      throw new HTTPException(409, { message: "version_conflict" });
    const previousConfig = row ? validateStoredRow(row) : null;
    const config = proposed.config;
    if (!config)
      throw new HTTPException(400, { message: "S3 configuration required" });
    const existingCredentials = readCredentials(row);
    assertDestinationCredentialSafety(
      previousConfig,
      config,
      proposed.credentials,
    );
    const parsedCredentials = s3DraftCredentialsSchema.safeParse(
      mergeCredentials(existingCredentials, proposed.credentials),
    );
    if (!parsedCredentials.success)
      throw new HTTPException(400, { message: "S3 credentials required" });
    const credentials = parsedCredentials.data;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(783182, hashtext(${actor.userId}))`,
    );
    const recent = await tx.execute<{ count: number }>(sql`
      SELECT count(*)::integer AS count FROM audit_log
      WHERE action = 'plugin.tested' AND entity_type = 'instance_plugin_config'
        AND entity_id IN (${row?.id ?? S3_DRAFT_PLUGIN_ID}, ${S3_DRAFT_PLUGIN_ID}) AND actor_id = ${actor.userId}
        AND created_at > clock_timestamp() - interval '1 minute'
    `);
    if ((recent.rows[0]?.count ?? 0) >= 5)
      throw new HTTPException(429, { message: "rate_limited" });
    await spend(tx);
    try {
      await appendAuditLog(tx, {
        action: "plugin.tested",
        actorId: actor.userId,
        actorType: "person",
        entityType: "instance_plugin_config",
        entityId: row?.id ?? S3_DRAFT_PLUGIN_ID,
        workspaceId: null,
        traceId: actor.traceId,
        after: { changedKeys: [] },
      });
    } catch {
      throw new HTTPException(503, {
        message: "S3 draft verification audit unavailable",
      });
    }
    return {
      kind: "ready" as const,
      selection: Object.freeze({
        version,
        config: Object.freeze(config),
        credentials: Object.freeze(credentials),
      }),
    };
  });
  return selected.selection;
}
