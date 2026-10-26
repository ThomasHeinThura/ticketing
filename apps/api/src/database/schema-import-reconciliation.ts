import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { importRunTable } from "./schema-imports";

export type ImportReconciliationStatus = "pass" | "attention" | "fail";

/**
 * P6 reconciliation snapshot: one current row per import run, replaced by each recompute
 * (`version` counts recomputes). Pinned to the run's immutable workspace/plugin/source through the
 * same composite key the record ledger uses. The jsonb holds counts, fixed codes and source/target
 * identifiers only: never credentials, signed URLs or free text.
 */
export const importReconciliationTable = pgTable(
  "import_reconciliation",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    importRunId: text("import_run_id").notNull(),
    pluginId: text("plugin_id").notNull(),
    sourceRef: text("source_ref").notNull(),
    status: text("status").$type<ImportReconciliationStatus>().notNull(),
    sourceAvailable: boolean("source_available").notNull().default(false),
    version: integer("version").notNull().default(1),
    seed: text("seed").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    computedBy: text("computed_by"),
    computedAt: timestamp("computed_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("import_reconciliation_run_key").on(t.importRunId),
    foreignKey({
      name: "import_reconciliation_run_scope_fk",
      columns: [t.workspaceId, t.importRunId, t.pluginId, t.sourceRef],
      foreignColumns: [
        importRunTable.workspaceId,
        importRunTable.id,
        importRunTable.pluginId,
        importRunTable.sourceRef,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("import_reconciliation_workspace_idx").on(
      t.workspaceId,
      t.computedAt,
    ),
    check(
      "import_reconciliation_status_allowed",
      sql`${t.status} IN ('pass','attention','fail')`,
    ),
    check("import_reconciliation_version_positive", sql`${t.version} > 0`),
    check(
      "import_reconciliation_snapshot_object",
      sql`jsonb_typeof(${t.snapshot}) = 'object'`,
    ),
  ],
);

export type CutoverRehearsalStatus = "passed" | "failed";

/**
 * Evidence of one cutover rehearsal on a restored COPY database (scripts/import-rehearsal). Written
 * after the rollback restore, so it survives it. Not tenant data: it names no records.
 */
export const cutoverRehearsalTable = pgTable(
  "cutover_rehearsal",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    rehearsalKey: text("rehearsal_key").notNull(),
    workspaceId: text("workspace_id"),
    importRunId: text("import_run_id"),
    status: text("status").$type<CutoverRehearsalStatus>().notNull(),
    databaseName: text("database_name").notNull(),
    /** Rehearsal-defined freeze boundary; no product contract exists (import-and-cutover.md). */
    freezeBoundary: jsonb("freeze_boundary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    steps: jsonb("steps")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    timings: jsonb("timings")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    report: jsonb("report")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    finishedAt: timestamp("finished_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("cutover_rehearsal_key").on(t.rehearsalKey),
    index("cutover_rehearsal_finished_idx").on(t.finishedAt),
    check(
      "cutover_rehearsal_status_allowed",
      sql`${t.status} IN ('passed','failed')`,
    ),
    check(
      "cutover_rehearsal_json_shapes",
      sql`jsonb_typeof(${t.freezeBoundary}) = 'object' AND jsonb_typeof(${t.steps}) = 'array' AND jsonb_typeof(${t.timings}) = 'object' AND jsonb_typeof(${t.report}) = 'object'`,
    ),
  ],
);
