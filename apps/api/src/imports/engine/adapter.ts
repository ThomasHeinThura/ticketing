/**
 * Import engine adapter contract (P6 Lane A).
 *
 * The engine (mapping, whole-run dry run, runner, losses) is source-agnostic. A source is an
 * `ImportSourceAdapter` registered under one of the allow-listed `import.*` plugin ids. Real
 * adapters (CSV, Jira/JSM, Azure DevOps, Plane, Planner, Power Apps, MCP) live in other lanes and
 * call `registerImportAdapter`; this file is the only coupling point.
 *
 * Adapter rules
 * -------------
 *  - READ-ONLY. An adapter never writes to the source (the connection row has `read_only = true`
 *    and the database refuses anything else).
 *  - `readPage` is deterministic and stable-ordered for a given source snapshot: the same cursor
 *    returns the same records in the same order. The cursor is opaque to the engine. A `null`
 *    `nextCursor` means the source is exhausted. The engine persists the cursor only together with
 *    the committed chunk, so a crash resumes from the last committed chunk (IM-3).
 *  - `connect` validates credentials and returns safe, non-secret facts. Never put a credential,
 *    token or signed URL in any returned value, loss detail or error message.
 *  - Everything an adapter returns that is not a core field is expressed as a `SourceFacet`
 *    (type, state, priority, person, label, module, cycle, custom_field, project). Mapping is
 *    resolved by the engine, not the adapter. `proposeMapping` may pre-fill proposals only.
 *  - `losses` on a record are fixed lower_snake codes (`^[a-z][a-z0-9_]{1,63}$`), for example
 *    `attachment_too_large`, `rich_text_lossy`, `revision_not_imported`. No free text (IM-4).
 *  - Source URLs must be https and carry no credentials (same rule as the record schema).
 *
 * Writer coupling (Lane B)
 * ------------------------
 * The engine never writes target rows itself. It resolves a `SourceRecord` through the saved
 * mapping to a `ResolvedRecord` and hands the canonical subset to the writer. Until the Lane B
 * record-v2 writer exists, `engine/chunk-writer.ts` uses the retained work-item writer
 * (`commitImportChunk`) whose canonical item carries only type, title, description, priority,
 * dates, labels and assignee. Everything else the source supplied is reported as a
 * `writer_unavailable` loss (never dropped silently, never claimed as imported). A Lane B writer
 * replaces `ChunkWriter` and flips the `WriterCapabilities` flags.
 */
import type { ImportPluginId } from "../../database/schema-imports";
import type {
  ImportAttachment,
  ImportComment,
  ImportHistoryEntry,
  ImportRelation,
} from "../schema";
import type { ImportAttachmentAuth } from "../writer/safe-fetch";

export type { ImportAttachmentAuth };

export const STATE_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;
export type StateGroup = (typeof STATE_GROUPS)[number];

export const MAPPING_DOMAINS = [
  "type",
  "state",
  "priority",
  "person",
  "label",
  "module",
  "cycle",
  "custom_field",
  "project",
] as const;
export type MappingDomain = (typeof MAPPING_DOMAINS)[number];

export type SourceFacet = { domain: MappingDomain; value: string };

export type LossInput = { code: string; detailCode?: string };

/** A custom field value read from the source, keyed by the source's own field key. */
export type SourceCustomFieldValue = { key: string; value: unknown };

/**
 * One source record, normalised by the adapter. All dates are ISO 8601 strings.
 *
 * Record v2: the structured members (comments, attachments, relations, history, custom field values)
 * mirror the writer's record schema. Anything the writer cannot persist is reported by the engine as a
 * `writer_unavailable` loss; nothing is dropped silently.
 */
export type SourceRecord = {
  sourceType: string;
  sourceId: string;
  /** https, no credentials. */
  sourceUrl?: string;
  /** sha256 hex of the source content; the engine derives one from the record when absent. */
  sourceHash?: string;
  title: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
  /** IM-6: preserved by the writer once it supports authorship/timestamps. */
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  sourceResolvedAt?: string;
  sourceAuthorEmail?: string;
  sourceAuthorName?: string;
  /** The person who raised the item in the source (no target slot yet: reported as a loss). */
  requester?: { email?: string; name?: string };
  /** Matched by email (case-insensitive) through the `person` mapping entries (IM-7). */
  assigneeEmail?: string;
  /** Same `sourceType`; cycles are detected and broken by the engine (IM edge case). */
  parentSourceId?: string;
  facets: SourceFacet[];
  comments?: ImportComment[];
  attachments?: ImportAttachment[];
  relations?: ImportRelation[];
  history?: ImportHistoryEntry[];
  customFields?: SourceCustomFieldValue[];
  /**
   * The adapter cannot hand this record to the writer (for example a duplicate source id). A fixed
   * lower_snake code; the engine rejects the record with exactly this code.
   */
  rejectCode?: string;
  losses?: LossInput[];
};

export type SourcePage = { records: SourceRecord[]; nextCursor: string | null };

/** Facts an adapter resolves from a stored connection. `credential` is plaintext, in memory only. */
export type AdapterConnection = {
  pluginId: ImportPluginId;
  config: Record<string, unknown>;
  credential: string | null;
  readOnly: true;
};

/** Fixed reasons a connect can fail with (surfaced to the wizard; never free text). */
export const CONNECT_FAILURE_REASONS = [
  "file_too_large",
  "too_many_rows",
  "too_many_columns",
  "unterminated_quote",
  "csv_text_missing",
  "missing_required_column",
  "export_text_missing",
  "invalid_export",
  "auth_failed",
  "unreachable",
  "not_found",
  "invalid_configuration",
  "source_error",
] as const;
export type ConnectFailureReason = (typeof CONNECT_FAILURE_REASONS)[number];

export type ConnectResult =
  | { ok: true; label?: string }
  | { ok: false; reason?: ConnectFailureReason };

export type DiscoveredFacet = {
  domain: MappingDomain;
  value: string;
  label?: string;
  /** Records carrying this value (drives the "4,000 items depend on this" view). */
  count: number;
};

export type DiscoveryResult = {
  facets: DiscoveredFacet[];
  /** Records per source type. */
  counts: Record<string, number>;
  totalRecords: number;
};

/** Targets a proposal or an operator may choose (see mapping.ts for per-domain validity). */
export type MappingTarget =
  | { kind: "target"; id: string }
  | { kind: "group"; group: StateGroup; stateId?: string }
  | { kind: "priority"; value: "low" | "medium" | "high" | "urgent" }
  | { kind: "placeholder" }
  | { kind: "ignore" };

export type ProposedMapping = {
  domain: MappingDomain;
  value: string;
  target: MappingTarget;
  confidence: "exact" | "heuristic";
};

/** What the destination offers; supplied by the engine so an adapter can propose real ids. */
export type ProposalContext = {
  workspaceId: string;
  projectId: string;
  /** Active staff person id by lower-cased email. */
  peopleByEmail: ReadonlyMap<string, string>;
  typeIdsByKey: ReadonlyMap<string, string>;
};

export interface ImportSourceAdapter {
  readonly pluginId: ImportPluginId;
  /** Source-specific page size (ADO 200, others 500). Capped at 500 by the engine. */
  readonly chunkSize: number;
  connect(connection: AdapterConnection): Promise<ConnectResult>;
  discover(connection: AdapterConnection): Promise<DiscoveryResult>;
  proposeMapping(
    discovery: DiscoveryResult,
    context: ProposalContext,
  ): Promise<ProposedMapping[]>;
  readPage(
    connection: AdapterConnection,
    cursor: string | null,
    pageSize: number,
  ): Promise<SourcePage>;
  /**
   * Credentials for downloading this source's attachments, resolved at download time (never stored in
   * a job, preview, loss or report). The headers are sent only to the listed hosts, which must be the
   * source's own configured host; the download keeps the SSRF, size and type guards.
   */
  attachmentAuth?(connection: AdapterConnection): ImportAttachmentAuth | null;
}

const registry = new Map<string, () => ImportSourceAdapter>();

export function registerImportAdapter(
  pluginId: ImportPluginId,
  factory: () => ImportSourceAdapter,
) {
  registry.set(pluginId, factory);
}

/**
 * Runs `register` and then restores every adapter that was already registered: startup registration
 * never replaces an adapter someone (a test fixture, a deployment hook) put there first.
 */
export function registerMissingImportAdapters(register: () => void) {
  const existing = new Map(registry);
  register();
  for (const [pluginId, factory] of existing) registry.set(pluginId, factory);
}

export function unregisterImportAdapter(pluginId: ImportPluginId) {
  registry.delete(pluginId);
}

export function getImportAdapter(pluginId: string): ImportSourceAdapter | null {
  return registry.get(pluginId)?.() ?? null;
}
