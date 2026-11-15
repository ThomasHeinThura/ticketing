import { type SQL, sql } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import { fenceLegalHolds } from "../scheduler/soft-delete-purge.repository";
import { dbClockUtc } from "../utils/db-time";
import {
  openHoldOver,
  workItemAttachmentOrganisations,
  workItemPeople,
} from "../utils/legal-hold-scope";

export const OPERATIONAL_NOTIFICATION_RETENTION_DAYS = 30;
export const DEFAULT_RETENTION_BATCH_SIZE = 500;
export const DEFAULT_RETENTION_MAX_BATCHES = 20;
export const DEFAULT_RETENTION_TIME_BUDGET_MS = 60_000;

export type OperationalRetentionOptions = {
  batchSize?: number;
  maxBatches?: number;
  timeBudgetMs?: number;
};

export type NotificationOutboxRetentionOutcome = {
  notificationDeliveriesPurged: number;
  notificationDigestsPurged: number;
  outboxEventsPurged: number;
};

const OPERATIONAL_RETENTION_WINDOW = sql`interval '30 days'`;

/**
 * `NO-17` retention: delete read notifications whose `read_at` is older than
 * `instance_setting.notification_retention_days`. Unread rows (and rows with no `read_at`)
 * are never eligible. A missing settings row makes the cutoff NULL, so nothing is deleted
 * (fail closed).
 *
 * Legal holds (`background-jobs.md`, "Retention obeys person, source, recipient and
 * resource-owner legal holds; unresolved ownership retains history conservatively"): a row is
 * retained while an open hold covers its recipient person, the recipient's organisation, or an
 * organisation that owns the referenced resource. A resource whose owner cannot be resolved
 * (deleted, or a type with no owner mapping) is retained while ANY open hold exists.
 *
 * `read_at` is a UTC wall clock in `timestamp without time zone`, so the cutoff is expressed in
 * the same convention (see `utils/db-time.ts`).
 */
const WORK_ITEM_MATCH = sql`(
  (n."resource_type" = 'work_item' AND (wi."id" = n."resource_id" OR wi."key" = n."resource_id"))
  OR (n."resource_type" = 'comment' AND wi."id" IN (SELECT c."work_item_id" FROM "comment" c WHERE c."id" = n."resource_id"))
  OR (n."resource_type" = 'approval' AND wi."id" IN (SELECT a."work_item_id" FROM "approval" a WHERE a."id" = n."resource_id"))
)`;

const RESOURCE_ORGANISATIONS = sql`
  SELECT p."organisation_id" AS oid FROM "work_item" wi JOIN "project" p ON p."id" = wi."project_id" WHERE ${WORK_ITEM_MATCH}
  UNION ALL
  SELECT w."organisation_id" FROM "work_item" wi JOIN "workspace" w ON w."id" = wi."workspace_id" WHERE ${WORK_ITEM_MATCH}
  UNION ALL
  SELECT s."organisation_id" FROM "submission" s WHERE n."resource_type" = 'submission' AND s."id" = n."resource_id"
  UNION ALL
  SELECT p."organisation_id" FROM "project" p WHERE n."resource_type" = 'project' AND p."id" = n."resource_id"
  UNION ALL
  SELECT p."organisation_id" FROM "prerequisite" pr JOIN "project" p ON p."id" = pr."project_id" WHERE n."resource_type" = 'prerequisite' AND pr."id" = n."resource_id"
  UNION ALL
  SELECT w."organisation_id" FROM "workspace" w WHERE n."resource_type" = 'workspace' AND w."id" = n."resource_id"
`;

/** Resource types whose notifications reference no organisation-owned row. */
const OWNERLESS_RESOURCE_TYPES = sql`('webhook', 'api_key', 'automation', 'pending_action', 'identity_connection', 'instance', 'person')`;

const RECIPIENTS = sql`
  SELECT pe."id" AS pid, pe."organisation_id" AS oid FROM "person" pe
  WHERE pe."id" = n."person_id" OR pe."user_id" = n."user_id"
`;

const UNDER_OPEN_HOLD = sql`(
  EXISTS (
    SELECT 1 FROM "legal_hold" lh
    WHERE lh."lifted_at" IS NULL
      AND (
        (lh."scope" = 'person' AND lh."scope_id" IN (SELECT r.pid FROM (${RECIPIENTS}) r))
        OR (lh."scope" = 'organisation' AND lh."scope_id" IN (SELECT r.oid FROM (${RECIPIENTS}) r))
        OR (lh."scope" = 'organisation' AND lh."scope_id" IN (SELECT ro.oid FROM (${RESOURCE_ORGANISATIONS}) ro))
      )
  )
  OR (
    NOT EXISTS (SELECT 1 FROM (${RESOURCE_ORGANISATIONS}) ro2)
    AND (n."resource_type" IS NULL OR n."resource_type" NOT IN ${OWNERLESS_RESOURCE_TYPES})
    AND EXISTS (SELECT 1 FROM "legal_hold" any_hold WHERE any_hold."lifted_at" IS NULL)
  )
)`;

/** Returns the number of notifications deleted. */
export async function purgeReadNotifications(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM "notification" n
    WHERE n."read_at" IS NOT NULL
      AND n."read_at" < ${dbClockUtc()} - make_interval(
        days => (SELECT s."notification_retention_days" FROM "instance_setting" s WHERE s."id" = 'singleton')
      )
      AND NOT ${UNDER_OPEN_HOLD}
      -- An external child still waiting (deferred by quiet hours, backing off) claims through this
      -- inbox row; deleting it would orphan the child so it stays pending forever.
      AND NOT EXISTS (
        SELECT 1 FROM "notification_delivery" d
        WHERE d."event_id" = n."event_id"
          AND d."recipient_person_id" = n."person_id"
          AND d."state" = 'pending'
      )
  `);
  return result.rowCount ?? 0;
}

const ANY_OPEN_HOLD_EXISTS = sql`EXISTS (
  SELECT 1 FROM "legal_hold" any_hold WHERE any_hold."lifted_at" IS NULL
)`;

/** Work items referenced by an `outbox` row (`o` alias) or any still-present inbox projection of it. */
function outboxWorkItems(o: SQL): SQL {
  return sql`
    SELECT wi."id" FROM "work_item" wi
    WHERE (
      jsonb_typeof(${o}."payload") = 'object'
      AND jsonb_typeof(${o}."payload"->'payload') = 'object'
      AND (
        wi."id" = (${o}."payload"->'payload'->>'workItemId')
        OR (
          wi."workspace_id" = ${o}."workspace_id"
          AND wi."key" = (${o}."payload"->'payload'->>'key')
        )
        OR wi."id" IN (
          SELECT c."work_item_id" FROM "comment" c
          WHERE c."id" = (${o}."payload"->'payload'->>'commentId')
        )
        OR wi."id" IN (
          SELECT a."work_item_id" FROM "approval" a
          WHERE a."id" = (${o}."payload"->'payload'->>'approvalId')
        )
      )
    )
    OR EXISTS (
      SELECT 1 FROM "notification" nx
      WHERE nx."event_id" = ${o}."event_id"
        AND (
          (nx."resource_type" = 'work_item' AND (wi."id" = nx."resource_id" OR (wi."workspace_id" = ${o}."workspace_id" AND wi."key" = nx."resource_id")))
          OR (nx."resource_type" = 'comment' AND wi."id" IN (SELECT c2."work_item_id" FROM "comment" c2 WHERE c2."id" = nx."resource_id"))
          OR (nx."resource_type" = 'approval' AND wi."id" IN (SELECT a2."work_item_id" FROM "approval" a2 WHERE a2."id" = nx."resource_id"))
        )
    )
  `;
}

/** Portal submissions referenced by an `outbox` row (`o` alias) or any still-present inbox projection. */
function outboxSubmissions(o: SQL): SQL {
  return sql`
    SELECT s."id" FROM "submission" s
    WHERE (
      jsonb_typeof(${o}."payload") = 'object'
      AND jsonb_typeof(${o}."payload"->'payload') = 'object'
      AND (
        s."id" = (${o}."payload"->'payload'->>'submissionId')
        OR ('SUB-' || s."number"::text) = (${o}."payload"->'payload'->>'ref')
      )
    )
    OR EXISTS (
      SELECT 1 FROM "notification" nx
      WHERE nx."event_id" = ${o}."event_id"
        AND nx."resource_type" = 'submission'
        AND nx."resource_id" = s."id"
    )
  `;
}

/** Projects referenced directly by scope, payload, prerequisite, or inbox projection on `outbox` row `o`. */
function outboxProjects(o: SQL): SQL {
  return sql`
    SELECT p."id" FROM "project" p
    WHERE (
      jsonb_typeof(${o}."payload") = 'object'
      AND (
        (jsonb_typeof(${o}."payload"->'scope') = 'object' AND p."id" = (${o}."payload"->'scope'->>'projectId'))
        OR (jsonb_typeof(${o}."payload"->'payload') = 'object' AND p."id" = (${o}."payload"->'payload'->>'projectId'))
        OR (
          jsonb_typeof(${o}."payload"->'payload') = 'object'
          AND p."id" IN (
            SELECT pr."project_id" FROM "prerequisite" pr
            WHERE pr."id" = (${o}."payload"->'payload'->>'prerequisiteId')
          )
        )
      )
    )
    OR EXISTS (
      SELECT 1 FROM "notification" nx
      WHERE nx."event_id" = ${o}."event_id"
        AND (
          (nx."resource_type" = 'project' AND nx."resource_id" = p."id")
          OR (
            nx."resource_type" = 'prerequisite'
            AND p."id" IN (SELECT pr2."project_id" FROM "prerequisite" pr2 WHERE pr2."id" = nx."resource_id")
          )
        )
    )
  `;
}

function outboxLegacyTasks(o: SQL): SQL {
  return sql`SELECT t."id" FROM "task" t
    WHERE t."id" = (${o}."payload"->'payload'->>'taskId')
      OR EXISTS (SELECT 1 FROM "notification" n
        WHERE n."event_id" = ${o}."event_id" AND n."resource_type" = 'task'
          AND n."resource_id" = t."id")`;
}

function outboxLegacyUsers(o: SQL): SQL {
  return sql`SELECT uid FROM (VALUES
    (${o}."payload"->'payload'->>'userId'),
    (${o}."payload"->'payload'->>'oldAssigneeId'),
    (${o}."payload"->'payload'->>'newAssigneeId')
  ) users(uid) WHERE uid IS NOT NULL AND uid <> ''`;
}

const WORKSPACE_OR_OPTIONAL_PROJECT_OUTBOX_KINDS = sql`(
  'workspace.created',
  'service_calendar.created',
  'service_calendar.updated',
  'service_calendar.deleted',
  'saved_view.created',
  'saved_view.updated',
  'saved_view.deleted',
  'saved_view.pinned',
  'import.chunk_completed'
)`;

const PROJECT_REQUIRED_OUTBOX_KINDS = sql`(
  'project.created',
  'project.archived',
  'budget.threshold_reached',
  'prerequisite.overdue',
  'comment.created',
  'comment.updated',
  'task-relation.created',
  'time-entry.created'
)`;

/**
 * True when the resource owner of `outbox` row `o` can be positively resolved (or the event kind
 * has sufficient persisted ownership evidence).
 * When false, conservative retention preserves the row while ANY `legal_hold` is open.
 */
function outboxResourceOwnershipResolved(
  o: SQL,
  workItems: SQL,
  submissions: SQL,
  projects: SQL,
): SQL {
  return sql`(
    jsonb_typeof(${o}."payload") = 'object'
    AND (
      (
        (
          ${o}."kind" LIKE 'work_item.%'
          OR ${o}."kind" LIKE 'approval.%'
          OR ${o}."kind" LIKE 'sla.%'
          OR ${o}."kind" = 'automation.notification_sent'
        )
        AND EXISTS (SELECT 1 FROM (${workItems}) resolved_wi)
      )
      OR (
        ${o}."kind" LIKE 'submission.%'
        AND EXISTS (SELECT 1 FROM (${submissions}) resolved_sub)
      )
      OR (
        ${o}."kind" IN ${PROJECT_REQUIRED_OUTBOX_KINDS}
        AND EXISTS (SELECT 1 FROM (${projects}) resolved_proj)
      )
      OR (
        ${o}."kind" IN ${WORKSPACE_OR_OPTIONAL_PROJECT_OUTBOX_KINDS}
        AND (
          CASE
            WHEN jsonb_typeof(${o}."payload"->'scope') = 'object'
              AND (${o}."payload"->'scope'->>'projectId') IS NOT NULL
              AND (${o}."payload"->'scope'->>'projectId') <> ''
            THEN EXISTS (
              SELECT 1 FROM "project" sp
              WHERE sp."id" = (${o}."payload"->'scope'->>'projectId')
            )
            ELSE EXISTS (
              SELECT 1 FROM "workspace" sw
              WHERE sw."id" = ${o}."workspace_id"
            )
          END
        )
      )
      OR (
        ${o}."kind" IN ('identity.provisioned', 'identity.deprovisioned')
        AND (
          ${o}."organisation_id" IS NOT NULL
          OR (
            jsonb_typeof(${o}."payload"->'scope') = 'object'
            AND (${o}."payload"->'scope'->>'organisationId') IS NOT NULL
            AND (${o}."payload"->'scope'->>'organisationId') <> ''
          )
          OR (
            jsonb_typeof(${o}."payload"->'payload') = 'object'
            AND EXISTS (
              SELECT 1 FROM "person" ipe
              WHERE ipe."id" = (${o}."payload"->'payload'->>'personId')
            )
          )
        )
      )
      OR (
        ${o}."kind" LIKE 'task.%'
        AND EXISTS (SELECT 1 FROM (${projects}) resolved_proj)
        AND EXISTS (SELECT 1 FROM (${outboxLegacyTasks(o)}) resolved_task)
        AND NOT EXISTS (SELECT 1 FROM (${outboxLegacyUsers(o)}) u
          WHERE NOT EXISTS (SELECT 1 FROM "person" p WHERE p."user_id" = u.uid))
        AND NOT EXISTS (SELECT 1 FROM "task" t WHERE t."id" IN (${outboxLegacyTasks(o)})
          AND t."assignee_id" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "person" p WHERE p."user_id" = t."assignee_id"))
      )
      OR (${o}."kind" = 'webhook.auto_disabled' AND (
        EXISTS (SELECT 1 FROM "person" p WHERE p."id" = NULLIF(${o}."payload"->'payload'->>'ownerPersonId', ''))
        OR EXISTS (SELECT 1 FROM "webhook" wh WHERE wh."id" = (${o}."payload"->'payload'->>'webhookId'))
      ))
      OR (${o}."kind" = 'api_key.auto_disabled' AND EXISTS (
        SELECT 1 FROM "apikey" ak WHERE ak."id" = (${o}."payload"->'payload'->>'apiKeyId')
          AND (EXISTS (SELECT 1 FROM "person" p WHERE p."user_id" = ak."user_id")
            OR EXISTS (SELECT 1 FROM "api_key" ext JOIN "person" p
              ON p."id" = ext."person_id" OR p."id" = ext."created_by_person_id"
              WHERE ext."apikey_id" = ak."id"))
      ))
      OR (${o}."kind" = 'automation.run_failed' AND EXISTS (
        SELECT 1 FROM "automation" au WHERE au."id" = (${o}."payload"->'payload'->>'automationId')
      ))
      OR (${o}."kind" LIKE 'pending_action.%' AND EXISTS (
        SELECT 1 FROM "pending_action" pa WHERE pa."id" = (${o}."payload"->'payload'->>'pendingActionId')
      ))
    )
  )`;
}

/**
 * True when an open legal hold covers `outbox` row `o` via its source/workspace/project
 * organisation, its actor/target/resource-attached people (or their organisations), its
 * resource-owner organisation, or conservatively when resource ownership cannot be resolved.
 */
function outboxUnderOpenHold(o: SQL): SQL {
  const workItems = sql`SELECT id FROM retained_work_items`;
  const submissions = sql`SELECT id FROM retained_submissions`;
  const projects = sql`SELECT id FROM retained_projects`;

  const people = sql`
    SELECT (${o}."payload"->'actor'->>'id') AS pid
    WHERE jsonb_typeof(${o}."payload") = 'object'
      AND jsonb_typeof(${o}."payload"->'actor') = 'object'
      AND (${o}."payload"->'actor'->>'type') = 'person'
      AND (${o}."payload"->'actor'->>'id') IS NOT NULL
    UNION ALL
    SELECT (${o}."payload"->'payload'->>'personId')
    WHERE jsonb_typeof(${o}."payload") = 'object'
      AND jsonb_typeof(${o}."payload"->'payload') = 'object'
      AND (${o}."payload"->'payload'->>'personId') IS NOT NULL
    UNION ALL
    SELECT NULLIF(${o}."payload"->'payload'->>'ownerPersonId', '')
    UNION ALL
    SELECT p."id" FROM "person" p WHERE p."user_id" IN (${outboxLegacyUsers(o)})
      OR p."user_id" IN (SELECT t."assignee_id" FROM "task" t WHERE t."id" IN (${outboxLegacyTasks(o)}))
    UNION ALL
    SELECT n."person_id" FROM "notification" n WHERE n."event_id" = ${o}."event_id"
    UNION ALL
    SELECT p."id" FROM "person" p JOIN "notification" n ON p."user_id" = n."user_id"
      WHERE n."event_id" = ${o}."event_id"
    UNION ALL
    SELECT nd."recipient_person_id" FROM "notification_delivery" nd WHERE nd."event_id" = ${o}."event_id"
    UNION ALL
    SELECT pa."requested_by_person_id" FROM "pending_action" pa WHERE pa."id" = (${o}."payload"->'payload'->>'pendingActionId')
    UNION ALL
    SELECT pa."decided_by_person_id" FROM "pending_action" pa WHERE pa."id" = (${o}."payload"->'payload'->>'pendingActionId')
    UNION ALL
    SELECT p."id" FROM "apikey" ak JOIN "person" p ON p."user_id" = ak."user_id"
      WHERE ak."id" = (${o}."payload"->'payload'->>'apiKeyId')
    UNION ALL
    ${workItemPeople(workItems)}
    UNION ALL
    SELECT s."requester_id" FROM "submission" s WHERE s."id" IN (${submissions})
    UNION ALL
    SELECT s."claimed_by" FROM "submission" s
    WHERE s."id" IN (${submissions}) AND s."claimed_by" IS NOT NULL
    UNION ALL
    SELECT wh."created_by" FROM "webhook" wh
    WHERE jsonb_typeof(${o}."payload") = 'object'
      AND jsonb_typeof(${o}."payload"->'payload') = 'object'
      AND wh."id" = (${o}."payload"->'payload'->>'webhookId')
    UNION ALL
    SELECT ak."person_id" FROM "api_key" ak
    WHERE jsonb_typeof(${o}."payload") = 'object'
      AND jsonb_typeof(${o}."payload"->'payload') = 'object'
      AND ak."apikey_id" = (${o}."payload"->'payload'->>'apiKeyId')
      AND ak."person_id" IS NOT NULL
    UNION ALL
    SELECT ak2."created_by_person_id" FROM "api_key" ak2
    WHERE jsonb_typeof(${o}."payload") = 'object'
      AND jsonb_typeof(${o}."payload"->'payload') = 'object'
      AND ak2."apikey_id" = (${o}."payload"->'payload'->>'apiKeyId')
      AND ak2."created_by_person_id" IS NOT NULL
    UNION ALL
    SELECT au."created_by" FROM "automation" au
    WHERE jsonb_typeof(${o}."payload") = 'object'
      AND jsonb_typeof(${o}."payload"->'payload') = 'object'
      AND au."id" = (${o}."payload"->'payload'->>'automationId')
  `;

  const organisations = sql`
    SELECT ${o}."organisation_id" AS oid WHERE ${o}."organisation_id" IS NOT NULL
    UNION ALL
    SELECT (${o}."payload"->'scope'->>'organisationId')
    WHERE jsonb_typeof(${o}."payload") = 'object'
      AND jsonb_typeof(${o}."payload"->'scope') = 'object'
      AND (${o}."payload"->'scope'->>'organisationId') IS NOT NULL
      AND (${o}."payload"->'scope'->>'organisationId') <> ''
    UNION ALL
    SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = ${o}."workspace_id"
    UNION ALL
    SELECT p."organisation_id" FROM "project" p
    WHERE p."id" IN (${projects})
       OR p."id" IN (SELECT wi."project_id" FROM "work_item" wi WHERE wi."id" IN (${workItems}))
    UNION ALL
    ${workItemAttachmentOrganisations(workItems)}
    UNION ALL
    SELECT pa."organisation_id" FROM "pending_action" pa WHERE pa."id" = (${o}."payload"->'payload'->>'pendingActionId')
    UNION ALL
    SELECT w."organisation_id" FROM "pending_action" pa JOIN "workspace" w ON w."id" = pa."workspace_id"
      WHERE pa."id" = (${o}."payload"->'payload'->>'pendingActionId')
    UNION ALL
    SELECT s."organisation_id" FROM "submission" s WHERE s."id" IN (${submissions})
  `;

  // Resolve each event's hold surface once instead of repeating the resource joins per person.
  return sql`EXISTS (
    WITH retained_work_items AS MATERIALIZED (${outboxWorkItems(o)}),
      retained_submissions AS MATERIALIZED (${outboxSubmissions(o)}),
      retained_projects AS MATERIALIZED (${outboxProjects(o)}),
      retained_people AS MATERIALIZED (${people})
    SELECT 1 WHERE
      ${openHoldOver(sql`SELECT pid FROM retained_people`, organisations)}
      OR (NOT ${outboxResourceOwnershipResolved(o, workItems, submissions, projects)} AND ${ANY_OPEN_HOLD_EXISTS})
  )`;
}

const DELIVERY_UNDER_OPEN_HOLD = sql`(
  ${openHoldOver(
    sql`SELECT d."recipient_person_id" AS pid`,
    sql`
      SELECT d."organisation_id" AS oid WHERE d."organisation_id" IS NOT NULL
      UNION ALL
      SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = d."workspace_id"
    `,
  )}
  OR EXISTS (
    SELECT 1 FROM "outbox" o
    WHERE o."event_id" = d."event_id"
      AND ${outboxUnderOpenHold(sql`o`)}
  )
  OR EXISTS (
    SELECT 1 FROM "notification" n
    WHERE n."event_id" = d."event_id"
      AND n."person_id" = d."recipient_person_id"
      AND ${UNDER_OPEN_HOLD}
  )
)`;

const DIGEST_UNDER_OPEN_HOLD = openHoldOver(
  sql`SELECT dg."recipient_person_id" AS pid`,
  sql`
    SELECT dg."organisation_id" AS oid WHERE dg."organisation_id" IS NOT NULL
    UNION ALL
    SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = dg."workspace_id"
  `,
);

function resolveRetentionBounds(options: OperationalRetentionOptions = {}): {
  batchSize: number;
  maxBatches: number;
  timeBudgetMs: number;
} {
  const batchSize = options.batchSize ?? DEFAULT_RETENTION_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DEFAULT_RETENTION_MAX_BATCHES;
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_RETENTION_TIME_BUDGET_MS;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError("Retention batchSize must be a positive integer");
  }
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1) {
    throw new RangeError("Retention maxBatches must be a positive integer");
  }
  if (!Number.isFinite(timeBudgetMs) || timeBudgetMs <= 0) {
    throw new RangeError("Retention timeBudgetMs must be positive");
  }
  return { batchSize, maxBatches, timeBudgetMs };
}

async function runBatchedPurge(
  executeBatch: (tx: Executor, limit: number) => Promise<number>,
  options: OperationalRetentionOptions = {},
  startedAt = Date.now(),
): Promise<number> {
  const { batchSize, maxBatches, timeBudgetMs } =
    resolveRetentionBounds(options);
  let totalDeleted = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    if (batch > 0 && Date.now() - startedAt >= timeBudgetMs) {
      break;
    }
    const deleted = await db.transaction(async (tx) => {
      await fenceLegalHolds(tx);
      return executeBatch(tx, batchSize);
    });
    totalDeleted += deleted;
    if (deleted < batchSize) {
      break;
    }
  }

  return totalDeleted;
}

/**
 * `P-20` step 1: purges terminal `notification_delivery` rows (`delivered`, `dead`, `suppressed`)
 * whose `updated_at` (`timestamp without time zone`, UTC wall clock) is older than 30 days,
 * skipping rows with an active dedupe reservation or an open person/source/recipient/resource-owner
 * legal hold (retaining conservatively when resource ownership cannot be resolved).
 */
export async function purgeTerminalNotificationDeliveries(
  options: OperationalRetentionOptions = {},
  startedAt = Date.now(),
): Promise<number> {
  return runBatchedPurge(
    async (tx, limit) => {
      const result = await tx.execute(sql`
        DELETE FROM "notification_delivery" target
        WHERE target."id" IN (
          SELECT d."id"
          FROM "notification_delivery" d
          WHERE d."state" IN ('delivered', 'dead', 'suppressed')
            AND d."updated_at" < ${dbClockUtc()} - ${OPERATIONAL_RETENTION_WINDOW}
            AND NOT EXISTS (
              SELECT 1 FROM "outbox_dedupe_reservation" r
              WHERE r."owner_delivery_id" = d."id"
                AND r."lease_expires_at" > ${dbClockUtc()}
            )
            AND NOT ${DELIVERY_UNDER_OPEN_HOLD}
          ORDER BY d."updated_at" ASC, d."id" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
      `);
      return result.rowCount ?? 0;
    },
    options,
    startedAt,
  );
}

/**
 * `P-20` step 2: purges empty terminal `notification_digest` groups (`delivered`, `dead`,
 * `suppressed`) older than 30 days (`updated_at` UTC wall clock) once no `notification_delivery`
 * row still references them (`notification_delivery_digest_fk` is `ON DELETE RESTRICT`, and any
 * pending, recent, or held child delivery keeps its digest group).
 */
export async function purgeEmptyTerminalNotificationDigests(
  options: OperationalRetentionOptions = {},
  startedAt = Date.now(),
): Promise<number> {
  return runBatchedPurge(
    async (tx, limit) => {
      const result = await tx.execute(sql`
        DELETE FROM "notification_digest" target
        WHERE target."id" IN (
          SELECT dg."id"
          FROM "notification_digest" dg
          WHERE dg."state" IN ('delivered', 'dead', 'suppressed')
            AND dg."updated_at" < ${dbClockUtc()} - ${OPERATIONAL_RETENTION_WINDOW}
            AND NOT EXISTS (
              SELECT 1 FROM "notification_delivery" nd
              WHERE nd."digest_id" = dg."id"
            )
            AND NOT ${DIGEST_UNDER_OPEN_HOLD}
          ORDER BY dg."updated_at" ASC, dg."id" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
      `);
      return result.rowCount ?? 0;
    },
    options,
    startedAt,
  );
}

/**
 * `P-20` step 3: purges unreferenced terminal `outbox` parent event envelopes (`delivered`,
 * `dead`) whose `updated_at` (`timestamptz`) is older than 30 days, only after no child
 * `notification`, `notification_delivery`, `webhook_delivery`, `automation_run`, or
 * `sla_escalation` row references the event, regardless of child state, and obeying legal holds.
 */
export async function purgeTerminalOutboxEvents(
  options: OperationalRetentionOptions = {},
  startedAt = Date.now(),
): Promise<number> {
  return runBatchedPurge(
    async (tx, limit) => {
      const result = await tx.execute(sql`
        DELETE FROM "outbox" target
        WHERE target."event_id" IN (
          SELECT o."event_id"
          FROM "outbox" o
          WHERE o."state" IN ('delivered', 'dead')
            AND o."updated_at" < clock_timestamp() - ${OPERATIONAL_RETENTION_WINDOW}
            AND NOT EXISTS (
              SELECT 1 FROM "notification_delivery" nd
              WHERE nd."event_id" = o."event_id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "notification" n
              WHERE n."event_id" = o."event_id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "webhook_delivery" wd
              WHERE wd."event_id" = o."event_id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "automation_run" ar
              WHERE ar."event_id" = o."event_id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "sla_escalation" se
              WHERE se."trigger_event_id" = o."event_id"
            )
            AND NOT ${outboxUnderOpenHold(sql`o`)}
          ORDER BY o."updated_at" ASC, o."event_id" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
      `);
      return result.rowCount ?? 0;
    },
    options,
    startedAt,
  );
}

/**
 * Runs the 30-day operational notification/outbox retention purges in strict child-before-parent
 * order (`notification_delivery` -> `notification_digest` -> `outbox`) within a shared time budget.
 */
export async function purgeNotificationAndOutboxRetention(
  options: OperationalRetentionOptions = {},
): Promise<NotificationOutboxRetentionOutcome> {
  const startedAt = Date.now();
  const notificationDeliveriesPurged =
    await purgeTerminalNotificationDeliveries(options, startedAt);
  const notificationDigestsPurged = await purgeEmptyTerminalNotificationDigests(
    options,
    startedAt,
  );
  const outboxEventsPurged = await purgeTerminalOutboxEvents(
    options,
    startedAt,
  );
  return {
    notificationDeliveriesPurged,
    notificationDigestsPurged,
    outboxEventsPurged,
  };
}
