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
import {
  apikeyTable,
  externalLinkTable,
  pendingActionTable,
  personTable,
  projectTable,
  workspaceTable,
} from "./schema";

export type ImportRunState =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed";
export type ImportChunkState =
  | "previewed"
  | "pending_approval"
  | "committed"
  | "rejected"
  | "failed";

/** Workspace/source-scoped operator mapping; only registered mapping versions are executable. */
export const importMappingProfileTable = pgTable(
  "import_mapping_profile",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    pluginId: text("plugin_id").notNull(),
    sourceRef: text("source_ref").notNull(),
    name: text("name").notNull(),
    mapping: jsonb("mapping").$type<Record<string, unknown>>().notNull(),
    mappingVersion: integer("mapping_version").notNull().default(1),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => personTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("import_profile_scope_source_key").on(
      t.workspaceId,
      t.id,
      t.pluginId,
      t.sourceRef,
    ),
    unique("import_profile_scope_name_key").on(
      t.workspaceId,
      t.pluginId,
      t.sourceRef,
      t.name,
    ),
    check(
      "import_profile_versions_positive",
      sql`${t.version} > 0 AND ${t.mappingVersion} > 0`,
    ),
    check(
      "import_profile_mapping_object",
      sql`jsonb_typeof(${t.mapping}) = 'object'`,
    ),
  ],
);

export const IMPORT_PLUGIN_IDS = [
  "import.csv",
  "import.jira",
  "import.jsm",
  "import.azure-devops",
  "import.plane",
  "import.planner",
  "import.power-apps",
  "import.mcp",
] as const;
export type ImportPluginId = (typeof IMPORT_PLUGIN_IDS)[number];
export type ImportEnginePhase =
  | "created"
  | "discovered"
  | "dry_run_ready"
  | "executing"
  | "completed";
export type ImportPausedReason =
  | "operator"
  | "authority_lost"
  | "project_reach_lost"
  | "mapping_changed"
  | "approval_invalid"
  | "approved_count_exceeded"
  | "source_error"
  | "chunk_failed"
  | "conflict";
const pluginIdSql = sql.raw(IMPORT_PLUGIN_IDS.map((id) => `'${id}'`).join(","));

/** P6: a read-only source connection. The credential is an enc:v2 envelope, never plaintext. */
export const importSourceConnectionTable = pgTable(
  "import_source_connection",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    pluginId: text("plugin_id").$type<ImportPluginId>().notNull(),
    name: text("name").notNull(),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    credentialCiphertext: text("credential_ciphertext"),
    readOnly: boolean("read_only").notNull().default(true),
    createdBy: text("created_by").references(() => personTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("import_source_connection_scope_key").on(t.workspaceId, t.id),
    unique("import_source_connection_name_key").on(
      t.workspaceId,
      t.pluginId,
      t.name,
    ),
    check(
      "import_source_connection_plugin_allowed",
      sql`${t.pluginId} IN (${pluginIdSql})`,
    ),
    check("import_source_connection_read_only", sql`${t.readOnly} = true`),
    check(
      "import_source_connection_config_object",
      sql`jsonb_typeof(${t.config}) = 'object'`,
    ),
  ],
);

/** Immutable destination/source scope; credentials never belong in sourceRef, stats or log. */
export const importRunTable = pgTable(
  "import_run",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id"),
    pluginId: text("plugin_id").notNull(),
    sourceRef: text("source_ref").notNull(),
    profileId: text("profile_id"),
    startedBy: text("started_by").references(() => personTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    startedByApiKeyId: text("started_by_api_key_id").references(
      () => apikeyTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    state: text("state").$type<ImportRunState>().notNull().default("queued"),
    stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
    log: jsonb("log")
      .$type<{ code: string; at: string; chunkId?: string }[]>()
      .notNull()
      .default([]),
    version: integer("version").notNull().default(1),
    dryRunDigest: text("dry_run_digest"),
    dryRunExpiresAt: timestamp("dry_run_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    nextCursor: text("next_cursor"),
    lastCommittedChunk: integer("last_committed_chunk").notNull().default(-1),
    // --- P6 Lane A (import engine, migration 0196) ---
    sourceConnectionId: text("source_connection_id"),
    enginePhase: text("engine_phase").$type<ImportEnginePhase>(),
    /** Adapter cursor wrapper: { cursor: string | null, exhausted: boolean }. */
    sourceCursor: jsonb("source_cursor").$type<{
      cursor: string | null;
      exhausted: boolean;
    } | null>(),
    pausedReason: text("paused_reason").$type<ImportPausedReason>(),
    approvedDigest: text("approved_digest"),
    approvedCount: integer("approved_count"),
    approvedMappingVersion: integer("approved_mapping_version"),
    approvalPendingActionId: text("approval_pending_action_id").references(
      () => pendingActionTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    engineDiscovery: jsonb("engine_discovery").$type<Record<
      string,
      unknown
    > | null>(),
    engineDryRunDigest: text("engine_dry_run_digest"),
    engineDryRunMappingVersion: integer("engine_dry_run_mapping_version"),
    engineDryRunReport: jsonb("engine_dry_run_report").$type<Record<
      string,
      unknown
    > | null>(),
    engineDryRunAt: timestamp("engine_dry_run_at", {
      mode: "date",
      withTimezone: true,
    }),
    // --- end P6 Lane A ---
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("import_run_scope_source_key").on(
      t.workspaceId,
      t.id,
      t.pluginId,
      t.sourceRef,
    ),
    foreignKey({
      name: "import_run_project_scope_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    })
      .onDelete("no action")
      .onUpdate("cascade"),
    foreignKey({
      name: "import_run_source_connection_scope_fk",
      columns: [t.workspaceId, t.sourceConnectionId],
      foreignColumns: [
        importSourceConnectionTable.workspaceId,
        importSourceConnectionTable.id,
      ],
    })
      .onDelete("no action")
      .onUpdate("cascade"),
    foreignKey({
      name: "import_run_profile_scope_fk",
      columns: [t.workspaceId, t.profileId, t.pluginId, t.sourceRef],
      foreignColumns: [
        importMappingProfileTable.workspaceId,
        importMappingProfileTable.id,
        importMappingProfileTable.pluginId,
        importMappingProfileTable.sourceRef,
      ],
    })
      .onDelete("no action")
      .onUpdate("cascade"),
    index("import_run_workspace_created_idx").on(
      t.workspaceId,
      t.createdAt,
      t.id,
    ),
    check(
      "import_run_state_allowed",
      sql`${t.state} IN ('queued','running','paused','completed','failed')`,
    ),
    check(
      "import_run_checkpoint_valid",
      sql`${t.version} > 0 AND ${t.lastCommittedChunk} >= -1`,
    ),
    check(
      "import_run_json_shapes",
      sql`jsonb_typeof(${t.stats}) = 'object' AND jsonb_typeof(${t.log}) = 'array'`,
    ),
    check(
      "import_run_preview_binding",
      sql`(${t.dryRunDigest} IS NULL) = (${t.dryRunExpiresAt} IS NULL) AND (${t.dryRunDigest} IS NULL OR ${t.dryRunDigest} ~ '^[a-f0-9]{64}$')`,
    ),
    check("import_run_plugin_allowed", sql`${t.pluginId} IN (${pluginIdSql})`),
    check(
      "import_run_engine_phase_allowed",
      sql`${t.enginePhase} IS NULL OR ${t.enginePhase} IN ('created','discovered','dry_run_ready','executing','completed')`,
    ),
    check(
      "import_run_paused_reason_allowed",
      sql`${t.pausedReason} IS NULL OR ${t.pausedReason} IN ('operator','authority_lost','project_reach_lost','mapping_changed','approval_invalid','approved_count_exceeded','source_error','chunk_failed','conflict')`,
    ),
    check(
      "import_run_engine_approval_shape",
      sql`(${t.approvedDigest} IS NULL) = (${t.approvedCount} IS NULL) AND (${t.approvedDigest} IS NULL) = (${t.approvedMappingVersion} IS NULL) AND (${t.approvedDigest} IS NULL OR ${t.approvedDigest} ~ '^[a-f0-9]{64}$') AND (${t.approvedCount} IS NULL OR ${t.approvedCount} >= 0) AND (${t.engineDryRunDigest} IS NULL OR ${t.engineDryRunDigest} ~ '^[a-f0-9]{64}$')`,
    ),
  ],
);

export type ImportTargetType =
  | "work_item"
  | "comment"
  | "attachment"
  | "relation"
  | "activity"
  | "person"
  | "label"
  | "cycle"
  | "module"
  | "custom_field";

/** One canonical source identity across reruns, pinned to the run's immutable workspace/source. */
export const importRecordLinkTable = pgTable(
  "import_record_link",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    pluginId: text("plugin_id").notNull(),
    sourceRef: text("source_ref").notNull(),
    importRunId: text("import_run_id").notNull(),
    firstImportRunId: text("first_import_run_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    sourceHash: text("source_hash"),
    targetContentHash: text("target_content_hash"),
    targetType: text("target_type").$type<ImportTargetType>().notNull(),
    targetId: text("target_id").notNull(),
    sourceUrl: text("source_url"),
    firstSeenAt: timestamp("first_seen_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    staleAt: timestamp("stale_at", { mode: "date", withTimezone: true }),
  },
  (t) => [
    unique("import_link_stable_source_key").on(
      t.workspaceId,
      t.pluginId,
      t.sourceRef,
      t.sourceType,
      t.sourceId,
      t.targetType,
    ),
    foreignKey({
      name: "import_link_current_run_scope_fk",
      columns: [t.workspaceId, t.importRunId, t.pluginId, t.sourceRef],
      foreignColumns: [
        importRunTable.workspaceId,
        importRunTable.id,
        importRunTable.pluginId,
        importRunTable.sourceRef,
      ],
    })
      .onDelete("no action")
      .onUpdate("cascade"),
    foreignKey({
      name: "import_link_first_run_scope_fk",
      columns: [t.workspaceId, t.firstImportRunId, t.pluginId, t.sourceRef],
      foreignColumns: [
        importRunTable.workspaceId,
        importRunTable.id,
        importRunTable.pluginId,
        importRunTable.sourceRef,
      ],
    })
      .onDelete("no action")
      .onUpdate("cascade"),
    index("import_link_current_run_idx").on(t.importRunId, t.id),
    check(
      "import_link_target_type_allowed",
      sql`${t.targetType} IN ('work_item','comment','attachment','relation','activity','person','label','cycle','module','custom_field')`,
    ),
    check(
      "import_link_hash_valid",
      sql`${t.sourceHash} IS NULL OR ${t.sourceHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "import_link_target_hash_valid",
      sql`${t.targetContentHash} IS NULL OR ${t.targetContentHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

/** Staged bytes are transient; committed reports/digests provide durable replay and resume. */
export const importChunkTable = pgTable(
  "import_chunk",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    importRunId: text("import_run_id")
      .notNull()
      .references(() => importRunTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    chunkId: text("chunk_id").notNull(),
    sequence: integer("sequence").notNull(),
    state: text("state")
      .$type<ImportChunkState>()
      .notNull()
      .default("previewed"),
    expectedRunVersion: integer("expected_run_version").notNull(),
    inputDigest: text("input_digest").notNull(),
    inputPayload: jsonb("input_payload").$type<Record<
      string,
      unknown
    > | null>(),
    report: jsonb("report")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    recordCount: integer("record_count").notNull(),
    sourceCursor: text("source_cursor"),
    pendingActionId: text("pending_action_id").references(
      () => pendingActionTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    committedAt: timestamp("committed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (t) => [
    unique("import_chunk_run_key").on(t.importRunId, t.chunkId),
    unique("import_chunk_run_sequence_key").on(t.importRunId, t.sequence),
    index("import_chunk_expiry_idx").on(t.expiresAt),
    check(
      "import_chunk_state_allowed",
      sql`${t.state} IN ('previewed','pending_approval','committed','rejected','failed')`,
    ),
    check(
      "import_chunk_bounds",
      sql`${t.sequence} >= 0 AND ${t.expectedRunVersion} > 0 AND ${t.recordCount} BETWEEN 1 AND 500`,
    ),
    check("import_chunk_hash_valid", sql`${t.inputDigest} ~ '^[a-f0-9]{64}$'`),
    check(
      "import_chunk_json_shapes",
      sql`jsonb_typeof(${t.report}) = 'object' AND (${t.inputPayload} IS NULL OR jsonb_typeof(${t.inputPayload}) = 'object')`,
    ),
    check(
      "import_chunk_committed_binding",
      sql`(${t.state} = 'committed') = (${t.committedAt} IS NOT NULL)`,
    ),
  ],
);

/** Private import provenance: never infer claim eligibility from an IdP email snapshot. */
export const importPlaceholderClaimTable = pgTable(
  "import_placeholder_claim",
  {
    personId: text("person_id")
      .primaryKey()
      .references(() => personTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    importRunId: text("import_run_id")
      .notNull()
      .references(() => importRunTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    normalizedEmail: text("normalized_email").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedAt: timestamp("claimed_at", { mode: "date", withTimezone: true }),
  },
  (t) => [
    index("import_placeholder_claim_email_idx").on(t.normalizedEmail),
    check(
      "import_placeholder_claim_email_shape",
      sql`length(${t.normalizedEmail}) BETWEEN 3 AND 320 AND ${t.normalizedEmail} = lower(btrim(${t.normalizedEmail})) AND position('@' in ${t.normalizedEmail}) > 1`,
    ),
  ],
);

/** P6 loss report: one fixed-code row per record that lost or could not carry something. */
export const importLossTable = pgTable(
  "import_loss",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    importRunId: text("import_run_id")
      .notNull()
      .references(() => importRunTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    importChunkId: text("import_chunk_id").references(
      () => importChunkTable.id,
      {
        onDelete: "set null",
        onUpdate: "cascade",
      },
    ),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    code: text("code").notNull(),
    detailCode: text("detail_code").notNull().default(""),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("import_loss_run_source_code_key").on(
      t.importRunId,
      t.sourceType,
      t.sourceId,
      t.code,
      t.detailCode,
    ),
    index("import_loss_run_idx").on(t.importRunId, t.id),
    check(
      "import_loss_code_shape",
      sql`${t.code} ~ '^[a-z][a-z0-9_]{1,63}$' AND (${t.detailCode} = '' OR ${t.detailCode} ~ '^[a-z][a-z0-9_]{1,63}$')`,
    ),
  ],
);

// --- P6 Lane B: import provenance (0198) -----------------------------------------------------
/**
 * Entity provenance lives on the physical `external_link` table (data-model.md section 11):
 * system, external id and URL for an imported work item, comment or attachment. One Drizzle
 * definition (`externalLinkTable` in schema.ts) so migration tooling sees one table; this alias
 * names the import writer's use of it.
 */
export const importProvenanceTable = externalLinkTable;
