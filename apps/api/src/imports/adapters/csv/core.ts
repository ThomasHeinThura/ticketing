/**
 * Profile-driven CSV family adapter core (P6 Lane C1): generic CSV, Planner CSV and Power Apps
 * CSV all run through `createCsvFamilyAdapter` with a different `CsvProfile`.
 *
 * File transport. The engine has no stored-file hook, so the CSV text travels in the source
 * connection's non-secret `config`:
 *
 *   config.csvText      the file content (UTF-8 text), at most CSV_LIMITS.maxBytes (5 MiB) and
 *                       50,000 data rows; larger files are refused at connect/discover with the
 *                       fixed code `file_too_large` / `too_many_rows` (nothing is truncated).
 *   config.delimiter    "," | ";" | "tab" (default: detected from the header line)
 *   config.columnMap    { field: "Header name" } saved column profile; overrides built-in aliases
 *   config.idColumn     header name of the unique id column (shortcut for columnMap.external_id)
 *   config.defaultType  type facet value for rows (or files) without a type column
 *   config.dateOrder    "mdy" | "dmy" for non-ISO dates (profile default applies)
 *
 * Behaviour rules
 *  - Read-only. No network. The credential is not used.
 *  - Nothing is silently coerced: an unparseable date, a malformed email, a ragged row, a duplicate
 *    id, an unknown column all become a per-record loss with a fixed lower_snake code.
 *  - `readPage` is a pure function of (csvText, config, cursor): the cursor is the zero-based data
 *    row index, so a resume after a crash returns exactly the same records.
 */
import { createHash } from "node:crypto";
import type { ImportPluginId } from "../../../database/schema-imports";
import type {
  AdapterConnection,
  ConnectFailureReason,
  DiscoveredFacet,
  DiscoveryResult,
  ImportSourceAdapter,
  LossInput,
  MappingDomain,
  MappingTarget,
  ProposalContext,
  ProposedMapping,
  SourceFacet,
  SourcePage,
  SourceRecord,
  StateGroup,
} from "../../engine/adapter";
import {
  CSV_LIMITS,
  type CsvDelimiter,
  type CsvParseResult,
  type CsvRow,
  normalizeDelimiter,
  parseCsv,
} from "./parse";

export type FieldName =
  | "external_id"
  | "title"
  | "description"
  | "type"
  | "state"
  | "priority"
  | "assignee_email"
  | "requester_email"
  | "created_by"
  | "created_at"
  | "resolved_at"
  | "start_date"
  | "due_date"
  | "labels"
  | "category"
  | "parent_external_id"
  | "project_key"
  | "bucket"
  | "progress"
  | "checklist"
  | "checklist_done"
  | "resolution_notes";

export type DateOrder = "iso" | "mdy" | "dmy";

export type CsvProfile = {
  pluginId: ImportPluginId;
  sourceType: string;
  /** Normalised header (lowercase, non-alphanumerics -> "_") per field. */
  aliases: Partial<Record<FieldName, string[]>>;
  /** Prefix of custom field columns, e.g. "cf_". `null`: none. */
  customFieldPrefix: string | null;
  /** Fields that must have a column for the file to be usable. */
  requiredFields: FieldName[];
  defaultType: string;
  dateOrder: DateOrder;
  /** Category column becomes a `type` facet (true) or a `label` facet (false). */
  categoryAsType: boolean;
  /** Split a person cell on ";" (Planner) and keep the first address. */
  multiAssignee: boolean;
  /** Derive the state facet value from the row's fields. */
  stateValue(fields: Partial<Record<FieldName, string>>): string | undefined;
  /** Proposed state group for a state facet value, or undefined when unsure. */
  proposeState(value: string): StateGroup | undefined;
  /** Priority proposal for a raw value, or undefined. */
  proposePriority(
    value: string,
  ): "low" | "medium" | "high" | "urgent" | undefined;
};

// --- helpers ---------------------------------------------------------------------------------

export const normalizeHeader = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

const EMAIL = /^[^\s@;,<>()"]+@[^\s@;,<>()"]+\.[^\s@;,<>()"]+$/u;
const LOSS_CODE = /^[a-z][a-z0-9_]{1,63}$/u;

export function detailCodeFor(header: string): string {
  const snake = normalizeHeader(header).slice(0, 60);
  const candidate = /^[a-z]/u.test(snake) ? snake : `c_${snake}`;
  return LOSS_CODE.test(candidate) ? candidate : "column";
}

function daysIn(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function utcIso(y: number, mo: number, d: number, h = 0, mi = 0, s = 0) {
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  if (h > 23 || mi > 59 || s > 59) return null;
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString();
}

/** Strict date parsing. ISO 8601 always; "m/d/y" or "d/m/y" only when the profile says so. */
export function parseDate(raw: string, order: DateOrder): string | null {
  const value = raw.trim();
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/u.exec(
      value,
    );
  if (iso) {
    const [, y, mo, d, h, mi, s, zone] = iso;
    if (h === undefined) return utcIso(Number(y), Number(mo), Number(d));
    // Validate the calendar day, then let Date apply the zone offset.
    if (
      !utcIso(
        Number(y),
        Number(mo),
        Number(d),
        Number(h),
        Number(mi),
        Number(s ?? 0),
      )
    )
      return null;
    const offset =
      zone && zone !== "Z" ? `${zone.slice(0, 3)}:${zone.slice(-2)}` : "Z";
    const parsed = new Date(
      `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}${zone ? offset : "Z"}`,
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (order === "iso") return null;
  const slashed =
    /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/iu.exec(
      value,
    );
  if (!slashed) return null;
  const [, a, b, y, hh, mi, ss, meridiem] = slashed;
  const month = order === "mdy" ? Number(a) : Number(b);
  const day = order === "mdy" ? Number(b) : Number(a);
  let hour = hh === undefined ? 0 : Number(hh);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toUpperCase() === "PM" ? 12 : 0);
  }
  return utcIso(Number(y), month, day, hour, Number(mi ?? 0), Number(ss ?? 0));
}

// --- configuration -----------------------------------------------------------------------------

export type CsvConfig = {
  text: string | null;
  delimiter: CsvDelimiter | "auto";
  columnMap: Partial<Record<FieldName, string>>;
  defaultType: string;
  dateOrder: DateOrder;
  categoryAsType: boolean;
};

const FIELD_NAMES = new Set<string>([
  "external_id",
  "title",
  "description",
  "type",
  "state",
  "priority",
  "assignee_email",
  "requester_email",
  "created_by",
  "created_at",
  "resolved_at",
  "start_date",
  "due_date",
  "labels",
  "category",
  "parent_external_id",
  "project_key",
  "bucket",
  "progress",
  "checklist",
  "checklist_done",
  "resolution_notes",
]);

export function readConfig(
  config: Record<string, unknown>,
  profile: CsvProfile,
): CsvConfig {
  const columnMap: Partial<Record<FieldName, string>> = {};
  const rawMap = config.columnMap;
  if (rawMap && typeof rawMap === "object" && !Array.isArray(rawMap))
    for (const [field, header] of Object.entries(rawMap))
      if (FIELD_NAMES.has(field) && typeof header === "string" && header.trim())
        columnMap[field as FieldName] = header.trim();
  if (typeof config.idColumn === "string" && config.idColumn.trim())
    columnMap.external_id = config.idColumn.trim();
  const order = config.dateOrder;
  return {
    text: typeof config.csvText === "string" ? config.csvText : null,
    delimiter: normalizeDelimiter(config.delimiter),
    columnMap,
    defaultType:
      typeof config.defaultType === "string" && config.defaultType.trim()
        ? config.defaultType.trim().slice(0, 120)
        : profile.defaultType,
    dateOrder:
      order === "mdy" || order === "dmy" || order === "iso"
        ? order
        : profile.dateOrder,
    categoryAsType:
      config.categoryAs === "label"
        ? false
        : config.categoryAs === "type"
          ? true
          : profile.categoryAsType,
  };
}

// --- column resolution -------------------------------------------------------------------------

export type ResolvedColumns = {
  /** header index per field */
  fields: Partial<Record<FieldName, number>>;
  /** custom field columns: header index and key */
  customFields: Array<{ index: number; key: string }>;
  /** headers nobody consumes -> reported per record */
  ignored: Array<{ index: number; header: string; detail: string }>;
  missingRequired: FieldName[];
};

export function resolveColumns(
  header: string[],
  duplicateHeaders: string[],
  profile: CsvProfile,
  config: CsvConfig,
): ResolvedColumns {
  const normalized = header.map(normalizeHeader);
  const duplicated = new Set(duplicateHeaders.map((h) => h.toLowerCase()));
  const seenHeaders = new Set<string>();
  const usable = header.map((name) => {
    const key = name.toLowerCase();
    const isFirst = !seenHeaders.has(key);
    seenHeaders.add(key);
    return name !== "" && (isFirst || !duplicated.has(key));
  });
  const fields: Partial<Record<FieldName, number>> = {};
  const used = new Set<number>();
  const claim = (field: FieldName, index: number) => {
    if (fields[field] === undefined && usable[index] && !used.has(index)) {
      fields[field] = index;
      used.add(index);
    }
  };
  for (const [field, name] of Object.entries(config.columnMap)) {
    const wanted = (name as string).toLowerCase();
    const index = header.findIndex((h) => h.toLowerCase() === wanted);
    if (index >= 0) claim(field as FieldName, index);
  }
  for (const [field, aliases] of Object.entries(profile.aliases)) {
    if (fields[field as FieldName] !== undefined) continue;
    for (const alias of aliases ?? []) {
      const index = normalized.indexOf(alias);
      if (index >= 0 && usable[index] && !used.has(index)) {
        claim(field as FieldName, index);
        break;
      }
    }
  }
  const customFields: ResolvedColumns["customFields"] = [];
  if (profile.customFieldPrefix)
    for (const [index, name] of normalized.entries()) {
      if (
        !used.has(index) &&
        usable[index] &&
        name.startsWith(profile.customFieldPrefix) &&
        name.length > profile.customFieldPrefix.length
      ) {
        customFields.push({
          index,
          key: name.slice(profile.customFieldPrefix.length),
        });
        used.add(index);
      }
    }
  const ignored = header
    .map((name, index) => ({
      index,
      header: name,
      detail: detailCodeFor(name),
    }))
    .filter(({ index, header: name }) => !used.has(index) && name !== "");
  const missingRequired = profile.requiredFields.filter(
    (f) => fields[f] === undefined,
  );
  return { fields, customFields, ignored, missingRequired };
}

// --- prepared file (parsed once per distinct text + config) -----------------------------------

type PreparedRow = {
  record: SourceRecord;
};

export type PreparedCsv = {
  parsed: CsvParseResult;
  columns: ResolvedColumns;
  records: PreparedRow[];
  config: CsvConfig;
};

const cache = new Map<string, PreparedCsv>();
const CACHE_SIZE = 4;

const cellOf = (row: CsvRow, index: number | undefined) =>
  index === undefined ? "" : (row.cells[index] ?? "").trim();

function buildRecords(
  parsed: CsvParseResult,
  columns: ResolvedColumns,
  profile: CsvProfile,
  config: CsvConfig,
): SourceRecord[] {
  const { fields } = columns;
  const idHasColumn = fields.external_id !== undefined;
  const allIds = new Set<string>();
  if (idHasColumn)
    for (const row of parsed.rows) {
      const id = cellOf(row, fields.external_id);
      if (id) allIds.add(id);
    }
  const seenIds = new Map<string, number>();
  const seenHashes = new Map<string, number>();
  const records: SourceRecord[] = [];

  for (const row of parsed.rows) {
    const losses: LossInput[] = [];
    const addLoss = (code: string, detailCode?: string) => {
      if (!losses.some((l) => l.code === code && l.detailCode === detailCode))
        losses.push(detailCode ? { code, detailCode } : { code });
    };
    for (const issue of row.issues) addLoss(issue);
    const get = (field: FieldName) => cellOf(row, fields[field]);
    const values: Partial<Record<FieldName, string>> = {};
    for (const field of Object.keys(fields) as FieldName[])
      values[field] = get(field);

    const rowJson = JSON.stringify(row.cells);
    const contentHash = sha(rowJson);

    // identity
    let sourceId = get("external_id");
    let invalidIdentity = false;
    if (sourceId === "") {
      if (idHasColumn) addLoss("external_id_missing");
      const occurrence = (seenHashes.get(contentHash) ?? 0) + 1;
      seenHashes.set(contentHash, occurrence);
      sourceId = `row-${contentHash.slice(0, 24)}${occurrence > 1 ? `~${occurrence}` : ""}`;
    } else {
      const occurrence = (seenIds.get(sourceId) ?? 0) + 1;
      seenIds.set(sourceId, occurrence);
      if (occurrence > 1) {
        // Never merged into the first row: reported and rejected (empty title, see below).
        addLoss("duplicate_source_id");
        sourceId = `${sourceId}~dup${occurrence}`;
        invalidIdentity = true;
      }
    }

    const facets: SourceFacet[] = [];
    const facet = (domain: MappingDomain, value: string) => {
      if (
        value &&
        !facets.some((f) => f.domain === domain && f.value === value)
      )
        facets.push({ domain, value });
    };

    // type: a type column wins; else the category (when it is the type); else the configured
    // default. A type column with an empty cell is NOT defaulted (the engine rejects the row).
    const category = get("category");
    const typeValue = get("type");
    if (fields.type !== undefined) facet("type", typeValue);
    else if (category && config.categoryAsType) facet("type", category);
    else facet("type", config.defaultType);
    if (category && !(config.categoryAsType && fields.type === undefined))
      facet("label", category);

    // state
    const state = profile.stateValue(values);
    if (state) facet("state", state);

    // priority
    const priority = get("priority");
    if (priority) facet("priority", priority);

    // labels
    for (const label of get("labels").split(";")) {
      const trimmed = label.trim();
      if (trimmed) facet("label", trimmed);
    }

    // project
    const project = get("project_key");
    if (project) facet("project", project);

    // custom fields: the key drives the mapping entry, the cell travels as the value
    const customFields: Array<{ key: string; value: string }> = [];
    for (const column of columns.customFields) {
      const value = cellOf(row, column.index);
      if (value) {
        facet("custom_field", column.key);
        customFields.push({ key: column.key, value });
      }
    }

    // people
    const emailOf = (raw: string, detail: string): string | undefined => {
      if (!raw) return undefined;
      const parts =
        profile.multiAssignee && detail === "assignee"
          ? raw
              .split(";")
              .map((p) => p.trim())
              .filter(Boolean)
          : [raw];
      const first = parts[0] ?? "";
      if (parts.length > 1) addLoss("additional_assignees_not_imported");
      if (EMAIL.test(first)) return first.toLowerCase();
      addLoss(
        first.includes("@") ? "invalid_email" : "person_not_email",
        detail,
      );
      return undefined;
    };
    const assigneeEmail = emailOf(get("assignee_email"), "assignee");
    const authorEmail = emailOf(get("created_by"), "author");
    let requesterEmail: string | undefined;
    if (get("requester_email")) {
      if (EMAIL.test(get("requester_email")))
        requesterEmail = get("requester_email").toLowerCase();
      else addLoss("invalid_email", "requester");
    }

    // dates
    const date = (field: FieldName): string | undefined => {
      const raw = get(field);
      if (!raw) return undefined;
      const parsedDate = parseDate(raw, config.dateOrder);
      if (!parsedDate) addLoss("invalid_date", field);
      return parsedDate ?? undefined;
    };
    const startDate = date("start_date");
    const dueDate = date("due_date");
    const createdAt = date("created_at");
    const resolvedAt = get("resolved_at") ? date("resolved_at") : undefined;

    // description (+ checklist / resolution notes folded in, each reported)
    let description = get("description") || undefined;
    const append = (heading: string, body: string) => {
      description = description
        ? `${description}\n\n${heading}\n${body}`
        : `${heading}\n${body}`;
    };
    const checklist = get("checklist");
    if (checklist) {
      const items = checklist
        .split(";")
        .map((i) => i.trim())
        .filter(Boolean);
      if (items.length) {
        const done = get("checklist_done");
        append(
          done
            ? `Checklist (${done} of ${items.length} completed)`
            : "Checklist",
          items.map((i) => `- ${i}`).join("\n"),
        );
        addLoss("checklist_flattened");
      }
    }
    const notes = get("resolution_notes");
    if (notes) {
      append("Resolution notes", notes);
      addLoss("resolution_notes_in_description");
    }

    // parent
    let parentSourceId: string | undefined;
    const parent = get("parent_external_id");
    if (parent) {
      if (parent === get("external_id")) addLoss("parent_self_reference");
      else if (!allIds.has(parent)) addLoss("parent_not_found");
      else parentSourceId = parent;
    }

    // columns nobody consumes
    for (const column of columns.ignored)
      if ((row.cells[column.index] ?? "").trim())
        addLoss("column_ignored", column.detail);

    const title = get("title");
    if (invalidIdentity) {
      // rejected by the engine as missing_title; the duplicate loss above explains why
      records.push({
        sourceType: profile.sourceType,
        sourceId,
        sourceHash: contentHash,
        title: "",
        facets,
        rejectCode: "duplicate_source_id",
        losses,
      });
      continue;
    }
    if (!title) addLoss("title_missing");

    records.push({
      sourceType: profile.sourceType,
      sourceId,
      sourceHash: contentHash,
      title,
      ...(description ? { description } : {}),
      ...(startDate ? { startDate } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(createdAt ? { sourceCreatedAt: createdAt } : {}),
      ...(resolvedAt ? { sourceResolvedAt: resolvedAt } : {}),
      ...(requesterEmail ? { requester: { email: requesterEmail } } : {}),
      ...(customFields.length ? { customFields } : {}),
      ...(authorEmail ? { sourceAuthorEmail: authorEmail } : {}),
      ...(assigneeEmail ? { assigneeEmail } : {}),
      ...(parentSourceId ? { parentSourceId } : {}),
      facets,
      ...(losses.length ? { losses } : {}),
    });
  }
  return records;
}

export type PrepareFailure = { fatal: string };

export function prepareCsv(
  connection: AdapterConnection,
  profile: CsvProfile,
): PreparedCsv | PrepareFailure {
  const config = readConfig(connection.config, profile);
  if (config.text === null) return { fatal: "csv_text_missing" };
  const key = sha(
    JSON.stringify([
      profile.pluginId,
      config.delimiter,
      config.columnMap,
      config.defaultType,
      config.dateOrder,
      config.categoryAsType,
    ]) + config.text,
  );
  const hit = cache.get(key);
  if (hit) return hit;
  const parsed = parseCsv(config.text, {
    delimiter: config.delimiter,
    ...CSV_LIMITS,
  });
  if (parsed.fatal) return { fatal: parsed.fatal };
  const columns = resolveColumns(
    parsed.header,
    parsed.duplicateHeaders,
    profile,
    config,
  );
  if (columns.missingRequired.length)
    return { fatal: "missing_required_column" };
  const prepared: PreparedCsv = {
    parsed,
    columns,
    config,
    records: buildRecords(parsed, columns, profile, config).map((record) => ({
      record,
    })),
  };
  cache.set(key, prepared);
  while (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return prepared;
}

export const isFailure = (
  value: PreparedCsv | PrepareFailure,
): value is PrepareFailure => "fatal" in value;

// --- discovery inspection (columns, sample, value sets) ---------------------------------------

export type CsvInspection = {
  delimiter: CsvDelimiter;
  columns: Array<{
    header: string;
    field: FieldName | "custom_field" | null;
    sample: string[];
  }>;
  ignoredColumns: string[];
  rowCount: number;
  valueSets: Record<string, Array<{ value: string; count: number }>>;
  issues: Record<string, number>;
};

export function inspectPrepared(prepared: PreparedCsv): CsvInspection {
  const { parsed, columns, records } = prepared;
  const fieldOf = new Map<number, FieldName | "custom_field">();
  for (const [field, index] of Object.entries(columns.fields))
    fieldOf.set(index as number, field as FieldName);
  for (const c of columns.customFields) fieldOf.set(c.index, "custom_field");
  const valueSets: CsvInspection["valueSets"] = {};
  const tally = new Map<string, Map<string, number>>();
  for (const { record } of records)
    for (const f of record.facets) {
      const map = tally.get(f.domain) ?? new Map<string, number>();
      map.set(f.value, (map.get(f.value) ?? 0) + 1);
      tally.set(f.domain, map);
    }
  for (const [domain, map] of tally)
    valueSets[domain] = [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 200)
      .map(([value, count]) => ({ value, count }));
  const issues: Record<string, number> = {};
  for (const { record } of records)
    for (const loss of record.losses ?? [])
      issues[loss.code] = (issues[loss.code] ?? 0) + 1;
  return {
    delimiter: parsed.delimiter,
    columns: parsed.header.map((header, index) => ({
      header,
      field: fieldOf.get(index) ?? null,
      sample: parsed.rows
        .slice(0, 5)
        .map((row) => (row.cells[index] ?? "").slice(0, 120)),
    })),
    ignoredColumns: columns.ignored.map((c) => c.header),
    rowCount: parsed.rows.length,
    valueSets,
    issues,
  };
}

// --- shared proposal heuristics ---------------------------------------------------------------

const STATE_WORDS: Array<[RegExp, StateGroup]> = [
  [/^(backlog|icebox|ice box|parked|new request)$/iu, "backlog"],
  [
    /^(todo|to do|to-do|open|new|not started|ready|planned|proposed|triage|queued|unstarted)$/iu,
    "unstarted",
  ],
  [
    /^(in progress|in-progress|doing|active|started|wip|working|in review|review|testing|in test|blocked|on hold|reopened|pending|waiting)$/iu,
    "started",
  ],
  [
    /^(done|closed|complete|completed|resolved|finished|fixed|shipped|released)$/iu,
    "completed",
  ],
  [
    /^(cancelled|canceled|won'?t do|wontfix|won'?t fix|rejected|duplicate|invalid|abandoned|declined|obsolete)$/iu,
    "cancelled",
  ],
];

export function genericStateGroup(value: string): StateGroup | undefined {
  const trimmed = value.trim();
  for (const [pattern, group] of STATE_WORDS)
    if (pattern.test(trimmed)) return group;
  return undefined;
}

export function genericPriority(
  value: string,
): "low" | "medium" | "high" | "urgent" | undefined {
  const v = value.trim().toLowerCase();
  if (/^(urgent|critical|blocker|highest|p0|p1|1|emergency|sev ?1)$/u.test(v))
    return "urgent";
  if (/^(high|important|major|p2|2|sev ?2)$/u.test(v)) return "high";
  if (/^(medium|normal|moderate|default|p3|3|sev ?3)$/u.test(v))
    return "medium";
  if (/^(low|minor|trivial|lowest|p4|4|sev ?4|none)$/u.test(v)) return "low";
  return undefined;
}

// --- the adapter ------------------------------------------------------------------------------

function csvFailureReason(fatal: string): ConnectFailureReason {
  switch (fatal) {
    case "file_too_large":
    case "too_many_rows":
    case "too_many_columns":
    case "unterminated_quote":
    case "csv_text_missing":
    case "missing_required_column":
      return fatal;
    default:
      return "csv_text_missing";
  }
}

export function createCsvFamilyAdapter(
  profile: CsvProfile,
  chunkSize = 500,
): ImportSourceAdapter {
  return {
    pluginId: profile.pluginId,
    chunkSize,
    async connect(connection) {
      const prepared = prepareCsv(connection, profile);
      return isFailure(prepared)
        ? { ok: false, reason: csvFailureReason(prepared.fatal) }
        : { ok: true };
    },
    async discover(connection): Promise<DiscoveryResult> {
      const prepared = prepareCsv(connection, profile);
      if (isFailure(prepared)) throw new Error(prepared.fatal);
      const counts: Record<string, number> = {};
      const facets = new Map<string, DiscoveredFacet>();
      const add = (domain: MappingDomain, value: string) => {
        const key = JSON.stringify([domain, value]);
        const current = facets.get(key);
        if (current) current.count += 1;
        else facets.set(key, { domain, value, count: 1 });
      };
      for (const { record } of prepared.records) {
        // Rejected duplicates / empty-title rows are not "work" and do not drive mapping.
        if (!record.title) continue;
        counts[record.sourceType] = (counts[record.sourceType] ?? 0) + 1;
        for (const f of record.facets) add(f.domain, f.value);
        if (record.assigneeEmail) add("person", record.assigneeEmail);
        if (record.sourceAuthorEmail) add("person", record.sourceAuthorEmail);
      }
      return {
        facets: [...facets.values()],
        counts,
        totalRecords: prepared.records.length,
      };
    },
    async proposeMapping(
      discovery: DiscoveryResult,
      context: ProposalContext,
    ): Promise<ProposedMapping[]> {
      const proposals: ProposedMapping[] = [];
      const push = (
        domain: MappingDomain,
        value: string,
        target: MappingTarget,
        confidence: "exact" | "heuristic",
      ) => proposals.push({ domain, value, target, confidence });
      for (const facet of discovery.facets) {
        if (facet.domain === "state") {
          const group = profile.proposeState(facet.value);
          if (group)
            push("state", facet.value, { kind: "group", group }, "heuristic");
        } else if (facet.domain === "priority") {
          const value = profile.proposePriority(facet.value);
          if (value)
            push(
              "priority",
              facet.value,
              { kind: "priority", value },
              "heuristic",
            );
        } else if (facet.domain === "type") {
          const lower = facet.value.toLowerCase();
          const exact = context.typeIdsByKey.get(facet.value);
          const loose =
            exact ??
            context.typeIdsByKey.get(lower) ??
            context.typeIdsByKey.get(normalizeHeader(facet.value));
          if (loose)
            push(
              "type",
              facet.value,
              { kind: "target", id: loose },
              exact ? "exact" : "heuristic",
            );
        } else if (facet.domain === "person") {
          const id = context.peopleByEmail.get(facet.value.toLowerCase());
          if (id) push("person", facet.value, { kind: "target", id }, "exact");
          else
            push("person", facet.value, { kind: "placeholder" }, "heuristic");
        } else if (facet.domain === "project") {
          // The run is bound to one project; a project_key column cannot re-route records.
          push("project", facet.value, { kind: "ignore" }, "heuristic");
        }
      }
      return proposals;
    },
    async readPage(connection, cursor, pageSize): Promise<SourcePage> {
      const prepared = prepareCsv(connection, profile);
      if (isFailure(prepared)) throw new Error(prepared.fatal);
      const start = cursor === null ? 0 : Number(cursor);
      if (!Number.isInteger(start) || start < 0) throw new Error("bad cursor");
      const end = Math.min(
        start + Math.max(pageSize, 1),
        prepared.records.length,
      );
      return {
        records: prepared.records.slice(start, end).map((r) => r.record),
        nextCursor: end < prepared.records.length ? String(end) : null,
      };
    },
  };
}

/** For the wizard (Lane D): columns, five-row samples, value sets and issue counts. */
export function inspectCsvConnection(
  connection: AdapterConnection,
  profile: CsvProfile,
): CsvInspection | PrepareFailure {
  const prepared = prepareCsv(connection, profile);
  return isFailure(prepared) ? prepared : inspectPrepared(prepared);
}
