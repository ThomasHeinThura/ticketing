import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { StepUpSpender } from "../auth/step-up-spend";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  organisationQuotaTable,
  personTable,
  webhookDeliveryTable,
  webhookTable,
  workspaceTable,
} from "../database/schema";
import { appendAuditSavepoint } from "../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import {
  decryptSecret,
  encryptSecret,
} from "../notification-preferences/secrets";
import { DEFAULT_MAX_WEBHOOKS } from "./constants";
import { buildTestWebhookBody } from "./envelope";
import {
  matchesExactWebhookSecretRotationSet,
  type RotateAllWebhookSecretsBody,
  rotateAllWebhookSecretsBody,
} from "./rotate-all";

export type WebhookRow = typeof webhookTable.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveryTable.$inferSelect;

export type WebhookActor = {
  userId: string;
  personId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
  actorIp?: string | null;
  userAgent?: string | null;
};

export class WebhookVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super("webhook_version_conflict");
  }
}

export class WebhookRotationSetConflictError extends Error {
  constructor() {
    super("webhook_rotation_set_changed");
  }
}

export async function findWebhookWorkspace(id: string) {
  const [row] = await db
    .select({ workspaceId: webhookTable.workspaceId })
    .from(webhookTable)
    .where(eq(webhookTable.id, id))
    .limit(1);
  return row;
}

export async function findDeliveryWorkspace(id: string) {
  const [row] = await db
    .select({
      workspaceId: webhookDeliveryTable.workspaceId,
      webhookId: webhookDeliveryTable.webhookId,
    })
    .from(webhookDeliveryTable)
    .where(eq(webhookDeliveryTable.id, id))
    .limit(1);
  return row;
}

export async function getWebhook(id: string, workspaceId: string) {
  const [row] = await db
    .select()
    .from(webhookTable)
    .where(
      and(eq(webhookTable.id, id), eq(webhookTable.workspaceId, workspaceId)),
    )
    .limit(1);
  return row;
}

type LastDelivery = {
  webhookId: string;
  state: string;
  statusCode: number | null;
  attemptedAt: Date | null;
};

export async function listWebhooks(workspaceId: string) {
  const rows = await db
    .select({
      webhook: webhookTable,
      ownerName: personTable.displayName,
    })
    .from(webhookTable)
    .leftJoin(personTable, eq(personTable.id, webhookTable.createdBy))
    .where(eq(webhookTable.workspaceId, workspaceId))
    .orderBy(webhookTable.createdAt, webhookTable.id);
  const ids = rows.map((row) => row.webhook.id);
  const last = new Map<string, LastDelivery>();
  if (ids.length > 0) {
    const latest = await db
      .selectDistinctOn([webhookDeliveryTable.webhookId], {
        webhookId: webhookDeliveryTable.webhookId,
        state: webhookDeliveryTable.state,
        statusCode: webhookDeliveryTable.statusCode,
        attemptedAt: webhookDeliveryTable.attemptedAt,
      })
      .from(webhookDeliveryTable)
      .where(
        and(
          inArray(webhookDeliveryTable.webhookId, ids),
          sql`${webhookDeliveryTable.attemptedAt} IS NOT NULL`,
        ),
      )
      .orderBy(
        webhookDeliveryTable.webhookId,
        desc(webhookDeliveryTable.attemptedAt),
      );
    for (const entry of latest) last.set(entry.webhookId, entry);
  }
  return rows.map((row) => ({
    row: row.webhook,
    ownerName: row.ownerName,
    last: last.get(row.webhook.id) ?? null,
  }));
}

/** `organisation_quota.max_webhooks` counted across every workspace of the organisation. */
export async function assertWebhookQuota(
  executor: Executor,
  workspaceId: string,
): Promise<void> {
  const [workspace] = await executor
    .select({ organisationId: workspaceTable.organisationId })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  if (!workspace)
    throw new HTTPException(404, { message: "Workspace not found" });
  const [quota] = await executor
    .select({ maxWebhooks: organisationQuotaTable.maxWebhooks })
    .from(organisationQuotaTable)
    .where(eq(organisationQuotaTable.organisationId, workspace.organisationId))
    .limit(1);
  const limit = quota?.maxWebhooks ?? DEFAULT_MAX_WEBHOOKS;
  const [used] = await executor
    .select({ value: count() })
    .from(webhookTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, webhookTable.workspaceId))
    .where(eq(workspaceTable.organisationId, workspace.organisationId));
  if ((used?.value ?? 0) >= limit) {
    throw new HTTPException(429, { message: "webhook_quota_exceeded" });
  }
}

function auditSnapshot(
  row: Pick<WebhookRow, "name" | "url" | "events" | "active">,
) {
  let host = "";
  try {
    host = new URL(row.url).host;
  } catch {
    host = "";
  }
  return {
    name: row.name,
    urlHost: host,
    // A path/query-only change keeps the host, so a short digest of the full URL (never the URL
    // itself, which may carry a token) makes that change visible in the audit trail.
    urlDigest: createHash("sha256").update(row.url).digest("hex").slice(0, 12),
    events: [...row.events],
    active: row.active,
  };
}

export async function createWebhook(input: {
  workspaceId: string;
  actor: WebhookActor;
  name: string;
  url: string;
  secret: string;
  events: string[];
  /** Spends the PA-15 proof in this transaction, immediately before the insert. */
  spend: StepUpSpender;
}): Promise<WebhookRow> {
  const outcome = await db.transaction(async (tx) => {
    await assertWebhookQuota(tx, input.workspaceId);
    const encrypted = encryptSecret(input.secret);
    if (!encrypted) throw new Error("Webhook secret could not be stored");
    await input.spend(tx);
    const [row] = await tx
      .insert(webhookTable)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        url: input.url,
        secret: encrypted,
        events: input.events,
        active: true,
        createdBy: input.actor.personId,
      })
      .returning();
    if (!row) throw new Error("Webhook insert returned no row");
    const auditFailed = await appendAuditSavepoint(tx, {
      actorId: input.actor.userId,
      actorType: input.actor.actorType,
      apiKeyId: input.actor.apiKeyId,
      actorIp: input.actor.actorIp ?? null,
      userAgent: input.actor.userAgent ?? null,
      workspaceId: input.workspaceId,
      action: "webhook.created",
      entityType: "webhook",
      entityId: row.id,
      after: auditSnapshot(row),
    });
    return { row, auditFailed };
  });
  if (outcome.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return outcome.row;
}

export type WebhookPatch = {
  name?: string;
  url?: string;
  events?: string[];
  active?: boolean;
  /** Re-own the webhook to the caller (`WH-14`: a paused webhook must be re-owned). */
  reown?: boolean;
  /** The owner the route authorised the change against; a concurrent re-own answers 409. */
  expectedOwner?: string;
  expectedVersion?: number;
};

/** Applies a validated patch. Returns the new row, or undefined when it no longer exists. */
export async function updateWebhook(
  id: string,
  workspaceId: string,
  patch: WebhookPatch,
  actor: WebhookActor,
  /** Spends the PA-15 proof in this transaction, after the checks and before the update. */
  spend?: StepUpSpender,
): Promise<WebhookRow | undefined> {
  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(webhookTable)
      .where(
        and(eq(webhookTable.id, id), eq(webhookTable.workspaceId, workspaceId)),
      )
      .for("update")
      .limit(1);
    if (!current) return undefined;
    if (
      patch.expectedVersion !== undefined &&
      patch.expectedVersion !== current.version
    )
      throw new WebhookVersionConflictError(current.version);
    if (spend) await spend(tx);

    const next: Partial<typeof webhookTable.$inferInsert> = {
      updatedAt: new Date(),
      version: current.version + 1,
    };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.events !== undefined) next.events = patch.events;
    if (
      patch.expectedOwner !== undefined &&
      patch.expectedOwner !== current.createdBy
    )
      throw new HTTPException(409, { message: "webhook_owner_changed" });
    if (patch.url !== undefined && patch.url !== current.url) {
      next.url = patch.url;
      next.destinationChangedAt = new Date();
      // A new destination starts a fresh failure window.
      next.failingSince = null;
      next.lastError = null;
    }
    if (patch.reown) {
      next.createdBy = actor.personId;
      if (actor.personId !== current.createdBy)
        next.destinationChangedAt = new Date();
    }
    // Re-enabling clears the pause; the owner is the caller if the webhook was re-owned.
    if (patch.active === true) {
      next.active = true;
      next.disabledAt = null;
      next.disabledReason = null;
      next.failingSince = null;
    } else if (patch.active === false) {
      next.active = false;
      next.disabledAt = new Date();
      next.disabledReason = "manual";
    }
    const [row] = await tx
      .update(webhookTable)
      .set(next)
      .where(eq(webhookTable.id, id))
      .returning();
    if (!row) return undefined;
    // Never the secret and never the full URL (it may carry credentials): the host only.
    const beforeSnap = updateAuditSnapshot(current);
    const afterSnap = updateAuditSnapshot(row);
    const changed = Object.keys(afterSnap).filter(
      (key) =>
        JSON.stringify(beforeSnap[key]) !== JSON.stringify(afterSnap[key]),
    );
    const auditFailed =
      changed.length === 0
        ? false
        : await appendAuditSavepoint(tx, {
            actorId: actor.userId,
            actorType: actor.actorType,
            apiKeyId: actor.apiKeyId,
            actorIp: actor.actorIp ?? null,
            userAgent: actor.userAgent ?? null,
            workspaceId,
            action: "webhook.updated",
            entityType: "webhook",
            entityId: id,
            before: Object.fromEntries(
              changed.map((key) => [key, beforeSnap[key] ?? null]),
            ),
            after: Object.fromEntries(
              changed.map((key) => [key, afterSnap[key] ?? null]),
            ),
          });
    return { row, auditFailed };
  });
  if (!outcome) return undefined;
  if (outcome.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return outcome.row;
}

function updateAuditSnapshot(
  row: Pick<WebhookRow, "name" | "url" | "events" | "active" | "createdBy">,
): Record<string, string | boolean | string[] | null> {
  return { ...auditSnapshot(row), ownerPersonId: row.createdBy ?? null };
}

export async function rotateWebhookSecret(
  id: string,
  workspaceId: string,
  newSecret: string,
  actor: WebhookActor,
  /** Spends the PA-15 proof in this transaction, immediately before the rotation. */
  spend: StepUpSpender,
): Promise<WebhookRow | undefined> {
  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(webhookTable)
      .where(
        and(eq(webhookTable.id, id), eq(webhookTable.workspaceId, workspaceId)),
      )
      .for("update")
      .limit(1);
    if (!current) return undefined;
    const encrypted = encryptSecret(newSecret);
    if (!encrypted) throw new Error("Webhook secret could not be stored");
    await spend(tx);
    const now = new Date();
    const [row] = await tx
      .update(webhookTable)
      .set({
        secret: encrypted,
        // WH-13: the outgoing secret keeps signing for 24 hours.
        secretPrevious: current.secret,
        secretRotatedAt: now,
        version: current.version + 1,
        updatedAt: now,
      })
      .where(eq(webhookTable.id, id))
      .returning();
    if (!row) return undefined;
    const auditFailed = await appendAuditSavepoint(tx, {
      actorId: actor.userId,
      actorType: actor.actorType,
      apiKeyId: actor.apiKeyId,
      actorIp: actor.actorIp ?? null,
      userAgent: actor.userAgent ?? null,
      workspaceId,
      action: "webhook.secret_rotated",
      entityType: "webhook",
      entityId: id,
      after: { secretRotatedAt: now.toISOString() },
    });
    return { row, auditFailed };
  });
  if (!outcome) return undefined;
  if (outcome.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return outcome.row;
}

/**
 * WH-13 incident rotation across the exact current webhook set. The exclusive table lock
 * blocks inserts, updates, and deletes until commit, so no endpoint can be omitted by a
 * concurrent create/delete or per-row rotation. The supplied secrets stay in request memory
 * only; each is encrypted before storage, and response/audit material never contains them.
 */
export async function rotateAllWebhookSecrets(input: {
  replacements: RotateAllWebhookSecretsBody;
  actor: WebhookActor;
  spend: StepUpSpender;
}): Promise<{ rotatedAt: Date; rotatedCount: number }> {
  const replacementsBody = rotateAllWebhookSecretsBody.parse(
    input.replacements,
  );
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE webhook IN EXCLUSIVE MODE`);
    const current = await tx
      .select()
      .from(webhookTable)
      .orderBy(webhookTable.id)
      .for("update");
    const versions = replacementsBody.webhooks.map(
      ({ webhookId, expectedVersion }) => ({
        webhookId,
        expectedVersion,
      }),
    );
    if (
      !matchesExactWebhookSecretRotationSet(
        versions,
        current.map(({ id, version }) => ({ id, version })),
      )
    ) {
      throw new WebhookRotationSetConflictError();
    }

    const replacements = new Map(
      replacementsBody.webhooks.map((entry) => [entry.webhookId, entry.secret]),
    );
    const encryptedById = new Map<string, string>();
    for (const row of current) {
      const secret = replacements.get(row.id);
      if (!secret) throw new WebhookRotationSetConflictError();
      const encrypted = encryptSecret(secret);
      if (!encrypted) throw new Error("Webhook secret could not be stored");
      encryptedById.set(row.id, encrypted);
    }

    await input.spend(tx);
    const now = new Date();
    let auditFailed = false;
    for (const row of current) {
      const encrypted = encryptedById.get(row.id);
      if (!encrypted) throw new WebhookRotationSetConflictError();
      const [updated] = await tx
        .update(webhookTable)
        .set({
          secret: encrypted,
          secretPrevious: row.secret,
          secretRotatedAt: now,
          version: row.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(webhookTable.id, row.id),
            eq(webhookTable.version, row.version),
          ),
        )
        .returning({ id: webhookTable.id });
      if (!updated) throw new WebhookRotationSetConflictError();
      const rowAuditFailed = await appendAuditSavepoint(tx, {
        actorId: input.actor.userId,
        actorType: input.actor.actorType,
        apiKeyId: input.actor.apiKeyId,
        actorIp: input.actor.actorIp ?? null,
        userAgent: input.actor.userAgent ?? null,
        workspaceId: row.workspaceId,
        action: "webhook.secret_rotated",
        entityType: "webhook",
        entityId: row.id,
        after: {
          secretRotatedAt: now.toISOString(),
          rotationReason: "instance_incident",
        },
      });
      auditFailed ||= rowAuditFailed;
    }
    return { rotatedAt: now, rotatedCount: current.length, auditFailed };
  });
  if (outcome.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return { rotatedAt: outcome.rotatedAt, rotatedCount: outcome.rotatedCount };
}

export function webhookSigningSecrets(row: WebhookRow): {
  secret: string;
  secretPrevious: string | null;
} {
  const secret = decryptSecret(row.secret);
  if (!secret) throw new Error("Webhook secret is unavailable");
  return {
    secret,
    secretPrevious: row.secretPrevious
      ? (decryptSecret(row.secretPrevious) ?? null)
      : null,
  };
}

export async function listDeliveries(
  webhookId: string,
  options: { limit: number; before?: Date },
) {
  return db
    .select()
    .from(webhookDeliveryTable)
    .where(
      and(
        eq(webhookDeliveryTable.webhookId, webhookId),
        options.before
          ? lt(webhookDeliveryTable.createdAt, options.before)
          : undefined,
      ),
    )
    .orderBy(
      desc(webhookDeliveryTable.createdAt),
      desc(webhookDeliveryTable.id),
    )
    .limit(options.limit + 1);
}

export async function getDelivery(id: string) {
  const [row] = await db
    .select()
    .from(webhookDeliveryTable)
    .where(eq(webhookDeliveryTable.id, id))
    .limit(1);
  return row;
}

/** `WH-8`: queue a fresh delivery of the same body for a specific earlier delivery. */
export async function enqueueRedelivery(
  original: WebhookDeliveryRow,
): Promise<WebhookDeliveryRow> {
  if (!original.requestBody) {
    throw new HTTPException(409, {
      message: "webhook_delivery_has_no_payload",
    });
  }
  const [row] = await db
    .insert(webhookDeliveryTable)
    .values({
      id: createId(),
      webhookId: original.webhookId,
      workspaceId: original.workspaceId,
      eventId: original.eventId,
      eventKind: original.eventKind,
      source: "redelivery",
      redeliveryOf: original.id,
      projectId: original.projectId,
      requestBody: original.requestBody,
      state: "pending",
      nextAttemptAt: new Date(),
    })
    .returning();
  if (!row) throw new Error("Redelivery insert returned no row");
  return row;
}

/** `Send test event`: a synthetic body, delivered through the same signed pipeline. */
export async function enqueueTestDelivery(input: {
  webhook: WebhookRow;
  instance: string;
  actorName: string;
  actorPersonId: string;
}): Promise<WebhookDeliveryRow> {
  const eventId = `evt_test_${createId()}`;
  const body = buildTestWebhookBody({
    deliveryEventId: eventId,
    occurredAt: new Date(),
    instance: input.instance,
    actor: { id: input.actorPersonId, name: input.actorName },
    webhookName: input.webhook.name,
  });
  const [row] = await db
    .insert(webhookDeliveryTable)
    .values({
      webhookId: input.webhook.id,
      workspaceId: input.webhook.workspaceId,
      eventId,
      eventKind: "webhook.test",
      source: "test",
      requestBody: body,
      state: "pending",
      nextAttemptAt: new Date(),
    })
    .returning();
  if (!row) throw new Error("Test delivery insert returned no row");
  return row;
}
