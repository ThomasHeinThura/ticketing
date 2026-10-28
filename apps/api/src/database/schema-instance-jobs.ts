import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { personTable } from "./schema";

const utc = { mode: "date", withTimezone: true } as const;

/** Runtime cadence overrides for the names registered by the process scheduler. */
export const instanceJobConfigurationTable = pgTable(
  "instance_job_configuration",
  {
    name: text("name").primaryKey(),
    /** NULL means the cadence shipped with the registered handler. */
    pattern: text("pattern"),
    enabled: boolean("enabled").default(true).notNull(),
    version: integer("version").default(1).notNull(),
    updatedAt: timestamp("updated_at", utc).defaultNow().notNull(),
    updatedByPersonId: text("updated_by_person_id").references(
      () => personTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
  },
  (table) => [
    check(
      "instance_job_configuration_version_positive",
      sql`${table.version} > 0`,
    ),
  ],
);

/** Metadata-only scheduled and administrator-requested execution history. */
export const instanceJobRunTable = pgTable(
  "instance_job_run",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    trigger: text("trigger").notNull(),
    state: text("state").notNull(),
    requestedAt: timestamp("requested_at", utc).defaultNow().notNull(),
    startedAt: timestamp("started_at", utc),
    heartbeatAt: timestamp("heartbeat_at", utc),
    finishedAt: timestamp("finished_at", utc),
    /** Opaque UUID for the one process currently reserving this execution. */
    runnerId: text("runner_id"),
    runLeaseExpiresAt: timestamp("run_lease_expires_at", utc),
    actorPersonId: text("actor_person_id").references(() => personTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** Closed diagnostic category only. Handler messages, results, and stacks are never stored. */
    errorCode: text("error_code"),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    check(
      "instance_job_run_trigger_allowed",
      sql`${table.trigger} IN ('scheduled', 'manual')`,
    ),
    check(
      "instance_job_run_state_allowed",
      sql`${table.state} IN ('queued', 'running', 'succeeded', 'failed', 'lease_lost')`,
    ),
    check(
      "instance_job_run_error_code_allowed",
      sql`${table.errorCode} IS NULL OR ${table.errorCode} IN ('handler_failed', 'authorization_lost', 'lease_lost')`,
    ),
    check(
      "instance_job_run_duration_nonnegative",
      sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`,
    ),
    check(
      "instance_job_run_lease_after_heartbeat",
      sql`${table.runLeaseExpiresAt} IS NULL OR (${table.heartbeatAt} IS NOT NULL AND ${table.runLeaseExpiresAt} > ${table.heartbeatAt})`,
    ),
    check(
      "instance_job_run_time_order",
      sql`(${table.startedAt} IS NULL OR ${table.requestedAt} <= ${table.startedAt})
        AND (${table.heartbeatAt} IS NULL OR (${table.startedAt} IS NOT NULL AND ${table.startedAt} <= ${table.heartbeatAt}))
        AND (${table.finishedAt} IS NULL OR (${table.startedAt} IS NOT NULL AND ${table.startedAt} <= ${table.finishedAt}))
        AND (${table.finishedAt} IS NULL OR ${table.heartbeatAt} IS NULL OR ${table.heartbeatAt} <= ${table.finishedAt})`,
    ),
    check(
      "instance_job_run_lifecycle_fields",
      sql`(
        (${table.state} = 'queued' AND ${table.trigger} = 'manual'
          AND ${table.startedAt} IS NULL AND ${table.heartbeatAt} IS NULL
          AND ${table.finishedAt} IS NULL AND ${table.runnerId} IS NULL
          AND ${table.runLeaseExpiresAt} IS NULL AND ${table.errorCode} IS NULL
          AND ${table.durationMs} IS NULL)
        OR
        (${table.state} = 'running' AND ${table.startedAt} IS NOT NULL
          AND ${table.heartbeatAt} IS NOT NULL AND ${table.finishedAt} IS NULL
          AND ${table.runnerId} IS NOT NULL AND ${table.runLeaseExpiresAt} IS NOT NULL
          AND ${table.errorCode} IS NULL AND ${table.durationMs} IS NULL)
        OR
        (${table.state} = 'succeeded' AND ${table.startedAt} IS NOT NULL
          AND ${table.heartbeatAt} IS NOT NULL AND ${table.finishedAt} IS NOT NULL
          AND ${table.runnerId} IS NULL AND ${table.runLeaseExpiresAt} IS NULL
          AND ${table.errorCode} IS NULL AND ${table.durationMs} IS NOT NULL)
        OR
        (${table.state} = 'failed' AND ${table.startedAt} IS NOT NULL
          AND ${table.heartbeatAt} IS NOT NULL AND ${table.finishedAt} IS NOT NULL
          AND ${table.runnerId} IS NULL AND ${table.runLeaseExpiresAt} IS NULL
          AND ${table.errorCode} IS NOT NULL
          AND ${table.errorCode} IN ('handler_failed', 'authorization_lost')
          AND ${table.durationMs} IS NOT NULL)
        OR
        (${table.state} = 'lease_lost' AND ${table.startedAt} IS NOT NULL
          AND ${table.finishedAt} IS NOT NULL AND ${table.runnerId} IS NULL
          AND ${table.runLeaseExpiresAt} IS NULL AND ${table.errorCode} IS NOT NULL
          AND ${table.errorCode} = 'lease_lost'
          AND ${table.durationMs} IS NULL)
      )`,
    ),
    uniqueIndex("instance_job_run_one_active_manual_idx")
      .on(table.name)
      .where(
        sql`${table.trigger} = 'manual' AND ${table.state} IN ('queued', 'running')`,
      ),
    index("instance_job_run_history_idx").on(table.name, table.requestedAt),
    index("instance_job_run_terminal_retention_idx")
      .on(table.requestedAt)
      .where(sql`${table.state} IN ('succeeded', 'failed', 'lease_lost')`),
  ],
);
