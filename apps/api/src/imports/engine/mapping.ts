/**
 * Mapping resolution, completeness and the five state groups (pure, no database).
 *
 * A mapping is a list of entries, one per discovered source value:
 *   `unmapped`   no target
 *   `proposed`   an automatic proposal the operator has not confirmed
 *   `confirmed`  a human choice (including an explicit `ignore`)
 * Only `confirmed` entries are executable. `unmapped` and `proposed` both block the run (IM-4:
 * never guessed). A mapping change bumps the profile version, which invalidates any dry run and
 * approval bound to the old version.
 */
import { createHash } from "node:crypto";
import {
  type ImportAttachment,
  type ImportComment,
  type ImportHistoryEntry,
  type ImportRelation,
  importAttachmentSchema,
  importCommentSchema,
  importHistorySchema,
  importRecordsSchema,
  importRelationSchema,
} from "../schema";
import {
  type DiscoveredFacet,
  type LossInput,
  MAPPING_DOMAINS,
  type MappingDomain,
  type MappingTarget,
  type ProposedMapping,
  type SourceRecord,
  STATE_GROUPS,
  type StateGroup,
} from "./adapter";

export type MappingStatus = "unmapped" | "proposed" | "confirmed";

export type MappingEntry = {
  domain: MappingDomain;
  value: string;
  target: MappingTarget | null;
  status: MappingStatus;
  /** Records depending on this value (from discovery). */
  affected: number;
};

export type MappingDocument = {
  version: 2;
  mode: "engine";
  entries: MappingEntry[];
};

export type MappingEdit = {
  domain: MappingDomain;
  value: string;
  /** `null` resets the entry to unmapped. */
  target: MappingTarget | null;
};

const LOSS_CODE = /^[a-z][a-z0-9_]{1,63}$/u;
export const entryKey = (domain: MappingDomain, value: string) =>
  JSON.stringify([domain, domain === "person" ? value.toLowerCase() : value]);

export function isMappingDomain(value: string): value is MappingDomain {
  return (MAPPING_DOMAINS as readonly string[]).includes(value);
}

/** Per-domain target validity. `ignore` is never valid for type or state (they are required). */
export function isValidTarget(
  domain: MappingDomain,
  target: MappingTarget,
): boolean {
  switch (target.kind) {
    case "group":
      return (
        domain === "state" &&
        (STATE_GROUPS as readonly string[]).includes(target.group)
      );
    case "priority":
      return domain === "priority";
    case "placeholder":
      return domain === "person";
    case "ignore":
      return domain !== "type" && domain !== "state";
    case "target":
      return (
        domain !== "state" &&
        domain !== "priority" &&
        typeof target.id === "string" &&
        target.id.length > 0 &&
        target.id.length <= 128
      );
    default:
      return false;
  }
}

/**
 * Rebuilds entries from discovery. Confirmed entries survive unchanged (the saved mapping is
 * reused on a second run); proposals only fill entries that are still unmapped; values no longer
 * discovered are dropped.
 */
export function mergeDiscovery(
  existing: readonly MappingEntry[],
  facets: readonly DiscoveredFacet[],
  proposals: readonly ProposedMapping[],
): MappingEntry[] {
  const previous = new Map(
    existing.map((e) => [entryKey(e.domain, e.value), e]),
  );
  const proposed = new Map(
    proposals
      .filter((p) => isValidTarget(p.domain, p.target))
      .map((p) => [entryKey(p.domain, p.value), p]),
  );
  const out = new Map<string, MappingEntry>();
  for (const facet of facets) {
    const key = entryKey(facet.domain, facet.value);
    const current = out.get(key);
    if (current) {
      current.affected += facet.count;
      continue;
    }
    const prior = previous.get(key);
    const proposal = proposed.get(key);
    const value =
      facet.domain === "person" ? facet.value.toLowerCase() : facet.value;
    if (prior && prior.status === "confirmed" && prior.target)
      out.set(key, { ...prior, value, affected: facet.count });
    else if (proposal)
      out.set(key, {
        domain: facet.domain,
        value,
        target: proposal.target,
        status: "proposed",
        affected: facet.count,
      });
    else
      out.set(key, {
        domain: facet.domain,
        value,
        target: null,
        status: "unmapped",
        affected: facet.count,
      });
  }
  return [...out.values()].sort(compareEntries);
}

function compareEntries(a: MappingEntry, b: MappingEntry) {
  return entryKey(a.domain, a.value).localeCompare(entryKey(b.domain, b.value));
}

export type MappingEditResult =
  | { ok: true; entries: MappingEntry[]; changed: boolean }
  | { ok: false; code: "unknown_mapping_value" | "invalid_mapping_target" };

/** Applies operator edits. `confirmProposals` accepts every proposal as is (one deliberate click). */
export function applyMappingEdits(
  entries: readonly MappingEntry[],
  edits: readonly MappingEdit[],
  confirmProposals: boolean,
): MappingEditResult {
  const next = new Map(
    entries.map((e) => [entryKey(e.domain, e.value), { ...e }]),
  );
  let changed = false;
  for (const edit of edits) {
    const entry = next.get(entryKey(edit.domain, edit.value));
    if (!entry) return { ok: false, code: "unknown_mapping_value" };
    if (edit.target === null) {
      if (entry.status !== "unmapped") changed = true;
      entry.target = null;
      entry.status = "unmapped";
      continue;
    }
    if (!isValidTarget(edit.domain, edit.target))
      return { ok: false, code: "invalid_mapping_target" };
    if (
      entry.status !== "confirmed" ||
      JSON.stringify(entry.target) !== JSON.stringify(edit.target)
    )
      changed = true;
    entry.target = edit.target;
    entry.status = "confirmed";
  }
  if (confirmProposals)
    for (const entry of next.values())
      if (entry.status === "proposed" && entry.target) {
        entry.status = "confirmed";
        changed = true;
      }
  return {
    ok: true,
    entries: [...next.values()].sort(compareEntries),
    changed,
  };
}

export type Completeness = {
  complete: boolean;
  total: number;
  unmapped: number;
  proposed: number;
  confirmed: number;
  /** Confirmed `ignore` entries (a subset of `confirmed`). */
  ignored: number;
  /** Blocking entries, capped for the wire. */
  blocking: Array<{
    domain: MappingDomain;
    value: string;
    status: MappingStatus;
    affected: number;
  }>;
  /** Records per state group over confirmed state entries (the five groups, always present). */
  stateGroups: Record<StateGroup, number>;
};

export function completeness(entries: readonly MappingEntry[]): Completeness {
  const stateGroups = Object.fromEntries(
    STATE_GROUPS.map((g) => [g, 0]),
  ) as Record<StateGroup, number>;
  let unmapped = 0;
  let proposed = 0;
  let confirmed = 0;
  let ignored = 0;
  const blocking: Completeness["blocking"] = [];
  for (const entry of entries) {
    if (entry.status === "confirmed" && entry.target) {
      confirmed += 1;
      if (entry.target.kind === "ignore") ignored += 1;
      if (entry.domain === "state" && entry.target.kind === "group")
        stateGroups[entry.target.group] += entry.affected;
      continue;
    }
    if (entry.status === "proposed") proposed += 1;
    else unmapped += 1;
    if (blocking.length < 200)
      blocking.push({
        domain: entry.domain,
        value: entry.value,
        status: entry.status,
        affected: entry.affected,
      });
  }
  return {
    complete: unmapped === 0 && proposed === 0,
    total: entries.length,
    unmapped,
    proposed,
    confirmed,
    ignored,
    blocking,
    stateGroups,
  };
}

export function mappingDigest(entries: readonly MappingEntry[]): string {
  const stable = entries.map((e) => [e.domain, e.value, e.status, e.target]);
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/** What the active writer can persist. Anything false is reported as `writer_unavailable`. */
export type WriterCapabilities = {
  state: boolean;
  parent: boolean;
  authorship: boolean;
  timestamps: boolean;
  modules: boolean;
  cycles: boolean;
  customFields: boolean;
  comments: boolean;
  attachments: boolean;
  relations: boolean;
  history: boolean;
  /** The target has no requester slot on a work item. */
  requester: boolean;
};

/** The retained work-item writer: type, title, description, priority, dates, labels, assignee. */
export const CANONICAL_WRITER_CAPABILITIES: WriterCapabilities = {
  state: false,
  parent: false,
  authorship: false,
  timestamps: false,
  modules: false,
  cycles: false,
  customFields: false,
  comments: false,
  attachments: false,
  relations: false,
  history: false,
  requester: false,
};

/**
 * The record-v2 writer (`imports/writer`): state, parent, relations, comments, attachments, history,
 * custom field values, authorship and source timestamps. Modules and cycles have no writer yet and
 * stay losses, as does the requester (no slot on a work item).
 */
export const WRITER_V2_CAPABILITIES: WriterCapabilities = {
  ...CANONICAL_WRITER_CAPABILITIES,
  state: true,
  parent: true,
  authorship: true,
  timestamps: true,
  customFields: true,
  comments: true,
  attachments: true,
  relations: true,
  history: true,
};

/**
 * Destination facts the pure resolver cannot know. Loaded once per page by the runner and the dry run
 * (`engine/context.ts`) and passed in so `resolveRecord` stays free of the database.
 */
export type ResolveContext = {
  /** Destination custom field key by id: the writer matches values on the field key. */
  customFieldKeyById?: ReadonlyMap<string, string>;
  /** The run's project state to use for a mapped state group (its default, else first). */
  stateIdByGroup?: ReadonlyMap<StateGroup, string>;
  /** Email of each mapped target person, to point nested authors at the mapped person. */
  personEmailById?: ReadonlyMap<string, string>;
};

export type ResolvedExtras = {
  stateGroup?: StateGroup;
  stateId?: string;
  parentSourceId?: string;
  authorPersonId?: string;
  placeholderEmails: string[];
  moduleIds: string[];
  cycleIds: string[];
  customFieldIds: string[];
};

export type ResolvedRecord = {
  sourceType: string;
  sourceId: string;
  sourceUrl?: string;
  sourceHash: string;
  /** Present when the record can be written; absent means rejected with `rejects`. */
  record: ReturnType<typeof parseImportRecord> | null;
  rejects: string[];
  losses: LossInput[];
  extras: ResolvedExtras;
};

function parseImportRecord(input: unknown) {
  const parsed = importRecordsSchema.safeParse([input]);
  return parsed.success ? (parsed.data[0] ?? null) : null;
}

/** https, no credentials, no credential-like query keys, no fragment (same rule as the record schema). */
export function safeSourceUrl(value: string | undefined): string | undefined {
  if (!value || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const credentialKey = [...url.searchParams.keys()].some((key) =>
      /(?:token|secret|password|authorization|api[-_]?key|credential|signature|^sig$)/iu.test(
        key,
      ),
    );
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !credentialKey &&
      !url.hash
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function deriveSourceHash(record: SourceRecord): string {
  const { sourceHash, losses: _losses, ...content } = record;
  if (sourceHash) return sourceHash;
  return createHash("sha256")
    .update(
      JSON.stringify(content, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).sort(
                ([a], [b]) => a.localeCompare(b),
              ),
            )
          : value,
      ),
    )
    .digest("hex");
}

export type MappingIndex = ReadonlyMap<string, MappingEntry>;
export const indexMapping = (entries: readonly MappingEntry[]): MappingIndex =>
  new Map(entries.map((e) => [entryKey(e.domain, e.value), e]));

function lookup(
  index: MappingIndex,
  domain: MappingDomain,
  value: string,
): MappingTarget | "unmapped" {
  const entry = index.get(entryKey(domain, value));
  if (entry?.status !== "confirmed" || !entry.target) return "unmapped";
  return entry.target;
}

/**
 * Resolves one source record through the mapping. Pure. Rejections are fixed codes; nothing is
 * guessed: an entry that is not confirmed rejects the record (`unmapped_value`), though a run
 * cannot normally reach execution while any entry is unconfirmed.
 */
const MEMBER_CAPS = {
  comments: 500,
  attachments: 100,
  relations: 200,
  customFields: 100,
  history: 1000,
} as const;

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const validEmail = (value: string) =>
  importCommentSchema.shape.authorEmail.safeParse(value).success;
const cleanName = (value: string | undefined) => {
  const name = value?.trim().slice(0, 200);
  return name && !name.includes("\u0000") ? name : undefined;
};
const isIso = (value: string | undefined): value is string =>
  value !== undefined &&
  ISO_DATETIME.test(value) &&
  !Number.isNaN(Date.parse(value));

export function resolveRecord(
  index: MappingIndex,
  source: SourceRecord,
  options: {
    capabilities: WriterCapabilities;
    brokenParents?: ReadonlySet<string>;
    context?: ResolveContext;
  },
): ResolvedRecord {
  const rejects: string[] = [];
  const losses: LossInput[] = [];
  const extras: ResolvedExtras = {
    placeholderEmails: [],
    moduleIds: [],
    cycleIds: [],
    customFieldIds: [],
  };
  const caps = options.capabilities;
  const context = options.context ?? {};
  const unwritable = (detail: string) => {
    if (
      !losses.some(
        (l) => l.code === "writer_unavailable" && l.detailCode === detail,
      )
    )
      losses.push({ code: "writer_unavailable", detailCode: detail });
  };
  const loss = (code: string, detailCode?: string) => {
    if (!losses.some((l) => l.code === code && l.detailCode === detailCode))
      losses.push(detailCode ? { code, detailCode } : { code });
  };

  let typeId: string | undefined;
  let priority: "low" | "medium" | "high" | "urgent" | undefined;
  const labelIds: string[] = [];
  let assigneeId: string | undefined;
  let stateId: string | undefined;

  const typeFacets = source.facets.filter((f) => f.domain === "type");
  const stateFacets = source.facets.filter((f) => f.domain === "state");
  if (typeFacets.length === 0) rejects.push("missing_type");
  if (stateFacets.length === 0) rejects.push("missing_state");
  if (source.rejectCode) {
    if (LOSS_CODE.test(source.rejectCode)) rejects.push(source.rejectCode);
    else rejects.push("invalid_reject_code");
  }

  for (const facet of source.facets) {
    const target = lookup(index, facet.domain, facet.value);
    if (target === "unmapped") {
      rejects.push("unmapped_value");
      continue;
    }
    if (target.kind === "ignore") {
      losses.push({ code: "facet_ignored", detailCode: facet.domain });
      continue;
    }
    switch (facet.domain) {
      case "type":
        if (target.kind === "target" && !typeId) typeId = target.id;
        break;
      case "state":
        if (target.kind === "group" && !extras.stateGroup) {
          extras.stateGroup = target.group;
          if (target.stateId) extras.stateId = target.stateId;
          if (!caps.state) unwritable("state");
          else {
            stateId =
              target.stateId ?? context.stateIdByGroup?.get(target.group);
            if (!stateId) loss("state_unresolved", target.group);
          }
        }
        break;
      case "priority":
        if (target.kind === "priority" && !priority) priority = target.value;
        break;
      case "label":
        if (target.kind === "target" && !labelIds.includes(target.id))
          labelIds.push(target.id);
        break;
      case "module":
        if (target.kind === "target") {
          extras.moduleIds.push(target.id);
          if (!caps.modules) unwritable("module");
        }
        break;
      case "cycle":
        if (target.kind === "target") {
          extras.cycleIds.push(target.id);
          if (!caps.cycles) unwritable("cycle");
        }
        break;
      case "custom_field":
        // The value itself travels in `source.customFields` (handled below); the facet only drives
        // the mapping entry.
        if (target.kind === "target") extras.customFieldIds.push(target.id);
        break;
      default:
        break;
    }
  }

  // People. A top-level assignee or author must be mapped (IM-7). Nested authors (comments, history,
  // attachments) are matched only through a CONFIRMED person entry and are never a reason to reject.
  let authorEmail: string | undefined;
  if (source.assigneeEmail) {
    const target = lookup(index, "person", source.assigneeEmail);
    if (target === "unmapped") rejects.push("unmapped_value");
    else if (target.kind === "target") assigneeId = target.id;
    else if (target.kind === "placeholder") {
      extras.placeholderEmails.push(source.assigneeEmail.toLowerCase());
      losses.push({ code: "person_placeholder", detailCode: "assignee" });
    } else losses.push({ code: "facet_ignored", detailCode: "person" });
  }
  if (source.sourceAuthorEmail) {
    const target = lookup(index, "person", source.sourceAuthorEmail);
    if (target === "unmapped") rejects.push("unmapped_value");
    else if (target.kind === "target") {
      extras.authorPersonId = target.id;
      authorEmail =
        context.personEmailById?.get(target.id) ?? source.sourceAuthorEmail;
    } else if (target.kind === "placeholder") {
      extras.placeholderEmails.push(source.sourceAuthorEmail.toLowerCase());
      losses.push({ code: "person_placeholder", detailCode: "author" });
      authorEmail = source.sourceAuthorEmail;
    } else losses.push({ code: "facet_ignored", detailCode: "person" });
    if (!caps.authorship) unwritable("authorship");
  }
  if (source.requester && (source.requester.email || source.requester.name))
    unwritable("requester");

  /** Nested author email: a confirmed target person substitutes theirs, `ignore` drops it. */
  const nestedEmail = (email: string | undefined): string | undefined => {
    if (!email) return undefined;
    const entry = index.get(entryKey("person", email));
    if (entry?.status !== "confirmed" || !entry.target)
      return validEmail(email) ? email : undefined;
    if (entry.target.kind === "ignore") return undefined;
    const mapped =
      entry.target.kind === "target"
        ? (context.personEmailById?.get(entry.target.id) ?? email)
        : email;
    return validEmail(mapped) ? mapped : undefined;
  };

  // Source timestamps (invalid values are dropped and reported, never guessed).
  const times: {
    sourceCreatedAt?: string;
    sourceUpdatedAt?: string;
    sourceResolvedAt?: string;
  } = {};
  if (caps.timestamps) {
    for (const [field, detail, value] of [
      ["sourceCreatedAt", "created", source.sourceCreatedAt],
      ["sourceUpdatedAt", "updated", source.sourceUpdatedAt],
      ["sourceResolvedAt", "resolved", source.sourceResolvedAt],
    ] as const) {
      if (value === undefined) continue;
      if (isIso(value)) times[field] = value;
      else loss("timestamp_invalid", detail);
    }
  } else if (
    source.sourceCreatedAt ||
    source.sourceUpdatedAt ||
    source.sourceResolvedAt
  )
    unwritable("timestamps");

  // Parent edge (same source type); a cycle edge broken by the engine is a loss, not a write.
  let parent: { sourceType: string; sourceId: string } | undefined;
  if (source.parentSourceId) {
    if (
      options.brokenParents?.has(
        JSON.stringify([source.sourceType, source.sourceId]),
      )
    )
      losses.push({ code: "parent_cycle_broken" });
    else {
      extras.parentSourceId = source.parentSourceId;
      if (!caps.parent) unwritable("parent");
      else
        parent = {
          sourceType: source.sourceType,
          sourceId: source.parentSourceId,
        };
    }
  }

  // Structured members, each validated on its own: one bad member is dropped and reported, it never
  // rejects the whole record. Members beyond the schema caps are truncated and reported.
  const members = <T>(
    name: keyof typeof MEMBER_CAPS,
    detail: string,
    invalidCode: string,
    raw: readonly unknown[] | undefined,
    capability: boolean,
    parse: (value: unknown) => T | null,
  ): T[] | undefined => {
    if (!raw?.length) return undefined;
    if (!capability) {
      unwritable(detail);
      return undefined;
    }
    const out: T[] = [];
    let invalid = false;
    for (const value of raw) {
      const parsed = parse(value);
      if (parsed === null) invalid = true;
      else out.push(parsed);
    }
    if (invalid) loss(invalidCode);
    if (out.length > MEMBER_CAPS[name]) {
      loss("members_truncated", detail);
      out.length = MEMBER_CAPS[name];
    }
    return out.length ? out : undefined;
  };
  const parseWith =
    <T>(schema: {
      safeParse: (v: unknown) => { success: boolean; data?: unknown };
    }) =>
    (value: unknown): T | null => {
      const result = schema.safeParse(value);
      return result.success ? (result.data as T) : null;
    };
  const withEmail = <T extends { authorEmail?: string }>(item: T): T => {
    if (!item.authorEmail) return item;
    const email = nestedEmail(item.authorEmail);
    const { authorEmail: _drop, ...rest } = item;
    return (email ? { ...rest, authorEmail: email } : rest) as T;
  };
  const comments = members<ImportComment>(
    "comments",
    "comment",
    "comment_invalid",
    source.comments,
    caps.comments,
    (v) => {
      const parsed = parseWith<ImportComment>(importCommentSchema)(v);
      return parsed ? withEmail(parsed) : null;
    },
  );
  const attachments = members<ImportAttachment>(
    "attachments",
    "attachment",
    "attachment_invalid",
    source.attachments,
    caps.attachments,
    (v) => {
      const parsed = parseWith<ImportAttachment>(importAttachmentSchema)(v);
      return parsed ? withEmail(parsed) : null;
    },
  );
  const relations = members<ImportRelation>(
    "relations",
    "relation",
    "relation_invalid",
    source.relations,
    caps.relations,
    parseWith<ImportRelation>(importRelationSchema),
  );
  const history = members<ImportHistoryEntry>(
    "history",
    "history",
    "history_invalid",
    source.history,
    caps.history,
    (v) => {
      const parsed = parseWith<ImportHistoryEntry>(importHistorySchema)(v);
      return parsed ? withEmail(parsed) : null;
    },
  );

  // Custom field values: the mapping entry (by source key) names the destination field; the writer
  // matches on the destination field KEY, so the id is translated through the context.
  const customFields: Array<{ key: string; value: unknown }> = [];
  if (source.customFields?.length) {
    if (!caps.customFields) unwritable("custom_field");
    else {
      for (const entry of source.customFields) {
        const target = lookup(index, "custom_field", entry.key);
        if (target === "unmapped") loss("custom_field_unmapped");
        else if (target.kind === "ignore")
          loss("facet_ignored", "custom_field");
        else if (target.kind === "target") {
          const key = context.customFieldKeyById?.get(target.id);
          if (!key) loss("custom_field_unmapped", "target_missing");
          else if (
            customFields.length < MEMBER_CAPS.customFields &&
            !JSON.stringify(entry.value)?.includes("\\u0000")
          )
            customFields.push({ key, value: entry.value });
          else loss("custom_field_invalid");
        }
      }
    }
  }

  const sourceUrl = safeSourceUrl(source.sourceUrl);
  if (source.sourceUrl && !sourceUrl)
    losses.push({ code: "source_url_dropped" });
  for (const lossInput of source.losses ?? [])
    losses.push(
      LOSS_CODE.test(lossInput.code) &&
        (lossInput.detailCode === undefined ||
          LOSS_CODE.test(lossInput.detailCode))
        ? lossInput
        : { code: "invalid_loss_code" },
    );
  const title = source.title?.trim() ?? "";
  if (!title) rejects.push("missing_title");

  let record: ResolvedRecord["record"] = null;
  const uniqueRejects = [...new Set(rejects)];
  if (uniqueRejects.length === 0 && typeId) {
    record = parseImportRecord({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      ...(sourceUrl ? { sourceUrl } : {}),
      sourceHash: deriveSourceHash(source),
      ...times,
      ...(authorEmail && caps.authorship && validEmail(authorEmail)
        ? { sourceAuthorEmail: authorEmail }
        : {}),
      ...(cleanName(source.sourceAuthorName) && caps.authorship
        ? { sourceAuthorName: cleanName(source.sourceAuthorName) }
        : {}),
      ...(stateId ? { stateId } : {}),
      ...(parent ? { parent } : {}),
      ...(comments ? { comments } : {}),
      ...(attachments ? { attachments } : {}),
      ...(relations ? { relations } : {}),
      ...(history ? { history } : {}),
      ...(customFields.length ? { customFields } : {}),
      item: {
        typeId,
        title,
        ...(source.description !== undefined
          ? { description: source.description }
          : {}),
        ...(priority ? { priority } : {}),
        ...(source.startDate ? { startDate: source.startDate } : {}),
        ...(source.dueDate ? { dueDate: source.dueDate } : {}),
        ...(labelIds.length ? { labelIds } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      },
    });
    if (!record) uniqueRejects.push("invalid_record");
  }
  return {
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    ...(sourceUrl ? { sourceUrl } : {}),
    sourceHash: deriveSourceHash(source),
    record,
    rejects: uniqueRejects,
    losses,
    extras,
  };
}
