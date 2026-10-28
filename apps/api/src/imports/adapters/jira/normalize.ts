/**
 * Jira issue (REST v2/v3 shape, also what a JSON export contains) to a `SourceRecord`.
 *
 * Pure: no I/O, no clock. Comments, attachments, issue links, changelog history and custom field
 * values travel on the record (record v2). What the target has no place for (worklogs, estimates,
 * versions, ...) is reported as a fixed-code loss on the record, never dropped silently. Comment visibility is
 * preserved: a restricted or JSM-internal comment is `internal` and is reported separately from
 * public ones.
 */
import type {
  LossInput,
  SourceFacet,
  SourceRecord,
} from "../../engine/adapter";
import { descriptionToText } from "./adf";

export const JIRA_SOURCE_TYPE = "issue";

export type Raw = Record<string, unknown>;
export const asObject = (value: unknown): Raw | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
export const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/u;
export function emailOf(user: unknown): string | undefined {
  const email = asString(asObject(user)?.emailAddress)?.trim().toLowerCase();
  return email && email.length <= 320 && EMAIL.test(email) ? email : undefined;
}

/** Jira timestamps look like `2025-01-12T10:23:45.123+0100`; make them ISO 8601. */
export function toIso(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) return undefined;
  const fixed = text.replace(/([+-]\d{2})(\d{2})$/u, "$1:$2");
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(fixed)
    ? new Date(`${fixed}T00:00:00.000Z`)
    : new Date(fixed);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export type FieldMap = {
  /** field id -> display name (from `expand=names` or the export). */
  names: ReadonlyMap<string, string>;
  /** Explicit overrides from the connection config. */
  epicLinkField?: string;
  startDateField?: string;
};

export type NormalizedComment = {
  id: string;
  authorEmail?: string;
  /** `internal` for a JSM internal note or any visibility-restricted Jira comment. */
  visibility: "public" | "internal";
  createdAt?: string;
  body: string;
};
export type NormalizedAttachment = {
  id: string;
  filename: string;
  size?: number;
  mimeType?: string;
  url?: string;
  createdAt?: string;
  authorEmail?: string;
};
export type NormalizedLink = {
  type: string;
  direction: "inward" | "outward";
  targetKey: string;
};
export type NormalizedWorklog = {
  authorEmail?: string;
  startedAt?: string;
  seconds: number;
};

export type NormalizedIssue = {
  key: string;
  record: SourceRecord;
  /** Human labels for discovery (`domain` + `value` -> label). */
  facetLabels: Array<{
    domain: SourceFacet["domain"];
    value: string;
    label: string;
  }>;
  comments: NormalizedComment[];
  attachments: NormalizedAttachment[];
  links: NormalizedLink[];
  worklogs: NormalizedWorklog[];
  changelogEntries: number;
};

/** Flavour hook: Jira Service Management specifics, supplied by `../jsm`. */
export type IssueFlavor = {
  inspect(input: { fields: Raw; names: ReadonlyMap<string, string> }): {
    /** Replaces the issue type facet (the JSM request type). */
    typeName?: string;
    /** Custom field ids that are not plain custom fields (SLA, approvals, ...). */
    excludedFields: Set<string>;
    losses: LossInput[];
  };
};

type RelationKind =
  | "relates"
  | "blocks"
  | "duplicates"
  | "precedes"
  | "requires";
/** Jira link type name (lower case) to the relation each side of the link holds; `skip` is the mirror. */
const JIRA_LINK_TYPES: Record<
  string,
  { outward: RelationKind | "skip"; inward: RelationKind | "skip" }
> = {
  blocks: { outward: "blocks", inward: "requires" },
  duplicate: { outward: "duplicates", inward: "skip" },
  relates: { outward: "relates", inward: "skip" },
  cloners: { outward: "relates", inward: "skip" },
};

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/iu;
const CATEGORY_DISPLAY: Record<string, string> = {
  new: "To Do",
  indeterminate: "In Progress",
  done: "Done",
  undefined: "No category",
};
export const CATEGORY_NAMES = Object.values(CATEGORY_DISPLAY);

/** Fields that are bookkeeping, not data worth a mapping row. */
const IGNORED_CUSTOM_NAMES = new Set(["rank", "development"]);

const pushLoss = (losses: LossInput[], code: string, detailCode?: string) => {
  if (!losses.some((l) => l.code === code && l.detailCode === detailCode))
    losses.push(detailCode ? { code, detailCode } : { code });
};

function sprintOf(
  value: unknown,
): { name: string; state: string; count: number } | undefined {
  const items = asArray(value);
  if (items.length === 0) return undefined;
  const parsed = items
    .map((item) => {
      const object = asObject(item);
      if (object) {
        const name = asString(object.name);
        const looksLikeSprint =
          "boardId" in object || "goal" in object || "originBoardId" in object;
        if (name && (looksLikeSprint || asString(object.state)))
          return { name, state: (asString(object.state) ?? "").toLowerCase() };
        return undefined;
      }
      const text = asString(item);
      if (text?.includes("Sprint@")) {
        const name = /[,[]name=([^,\]]+)/u.exec(text)?.[1];
        const state = /[,[]state=([A-Za-z]+)/u.exec(text)?.[1];
        if (name) return { name, state: (state ?? "").toLowerCase() };
      }
      return undefined;
    })
    .filter((item): item is { name: string; state: string } => Boolean(item));
  if (parsed.length === 0) return undefined;
  const active = parsed.find((item) => item.state === "active");
  const chosen = active ?? parsed[parsed.length - 1];
  return chosen ? { ...chosen, count: parsed.length } : undefined;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  const object = asObject(value);
  return object ? Object.keys(object).length === 0 : false;
}

/** A custom field value the writer can validate: text, number, boolean or a list of names. */
function customFieldScalar(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 5000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = (item: unknown): string | undefined => {
    if (typeof item === "string") return item;
    const object = asObject(item);
    return (
      asString(object?.value) ??
      asString(object?.name) ??
      asString(object?.displayName)
    );
  };
  if (Array.isArray(value)) {
    const items = value.map(text).filter((v): v is string => v !== undefined);
    return items.length === value.length ? items : undefined;
  }
  const object = asObject(value);
  if (object && object.type === "doc") return descriptionToText(value).text;
  return text(value);
}

function commentVisibility(comment: Raw): "public" | "internal" {
  if (comment.jsdPublic === false) return "internal";
  if (asObject(comment.visibility)) return "internal";
  return "public";
}

export function normalizeIssue(
  raw: Raw,
  options: {
    fieldMap: FieldMap;
    /** https site origin for `/browse/KEY` links; no credentials. */
    siteUrl?: string;
    flavor?: IssueFlavor;
  },
): NormalizedIssue {
  const key = asString(raw.key) ?? "";
  const fields = asObject(raw.fields) ?? {};
  const names = options.fieldMap.names;
  const facets: SourceFacet[] = [];
  const facetLabels: NormalizedIssue["facetLabels"] = [];
  const losses: LossInput[] = [];
  const addFacet = (facet: SourceFacet, label?: string) => {
    if (
      !facets.some((f) => f.domain === facet.domain && f.value === facet.value)
    )
      facets.push(facet);
    if (label) facetLabels.push({ ...facet, label });
  };

  const flavorResult = options.flavor?.inspect({ fields, names });
  for (const loss of flavorResult?.losses ?? [])
    pushLoss(losses, loss.code, loss.detailCode);
  const excluded = flavorResult?.excludedFields ?? new Set<string>();

  // Type.
  const issueType = asString(asObject(fields.issuetype)?.name);
  const typeName = flavorResult?.typeName ?? issueType;
  if (typeName) addFacet({ domain: "type", value: typeName });
  else {
    addFacet({ domain: "type", value: "Issue" });
    pushLoss(losses, "issue_type_missing");
  }

  // State: status, refined by resolution only inside the Done category (completed vs cancelled).
  const status = asObject(fields.status);
  const statusName = asString(status?.name) ?? "Unknown";
  const categoryKey =
    asString(asObject(status?.statusCategory)?.key)?.toLowerCase() ??
    "undefined";
  const categoryName = CATEGORY_DISPLAY[categoryKey] ?? "No category";
  const resolution = asString(asObject(fields.resolution)?.name);
  if (categoryKey === "done" && resolution) {
    addFacet(
      { domain: "state", value: `${statusName} / ${resolution}` },
      `${categoryName} · ${resolution}`,
    );
  } else {
    addFacet({ domain: "state", value: statusName }, categoryName);
  }

  // Priority.
  const priority = asString(asObject(fields.priority)?.name);
  if (priority) addFacet({ domain: "priority", value: priority });

  // Labels and components.
  for (const label of asArray(fields.labels)) {
    const value = asString(label);
    if (value) addFacet({ domain: "label", value });
  }
  for (const component of asArray(fields.components)) {
    const value = asString(asObject(component)?.name);
    if (value) addFacet({ domain: "label", value });
  }

  // Sprint (cycle) - the active sprint, else the most recent one.
  const sprintFieldIds: string[] = [];
  let sprint: ReturnType<typeof sprintOf>;
  for (const [id, value] of Object.entries(fields)) {
    if (!id.startsWith("customfield_")) continue;
    const found = sprintOf(value);
    if (found) {
      sprintFieldIds.push(id);
      sprint ??= found;
    }
  }
  if (sprint) {
    addFacet({ domain: "cycle", value: sprint.name });
    if (sprint.count > 1) pushLoss(losses, "sprint_history_not_imported");
  }

  // Parent: sub-task / next-gen parent, else the classic Epic Link.
  let parentSourceId = asString(asObject(fields.parent)?.key);
  const epicLinkIds = new Set<string>(["customfield_10014"]);
  if (options.fieldMap.epicLinkField)
    epicLinkIds.add(options.fieldMap.epicLinkField);
  for (const [id, name] of names)
    if (name.toLowerCase() === "epic link") epicLinkIds.add(id);
  if (!parentSourceId)
    for (const id of epicLinkIds) {
      const value = asString(fields[id]);
      if (value && KEY.test(value)) {
        parentSourceId = value;
        break;
      }
    }
  if (parentSourceId === key) parentSourceId = undefined;

  // Start date.
  const startDateIds = new Set<string>();
  if (options.fieldMap.startDateField)
    startDateIds.add(options.fieldMap.startDateField);
  for (const [id, name] of names)
    if (name.toLowerCase() === "start date") startDateIds.add(id);
  let startDate: string | undefined;
  for (const id of startDateIds) {
    startDate = toIso(fields[id]);
    if (startDate) break;
  }

  // Custom fields: identity only (the record contract carries no values yet).
  const special = new Set<string>([
    ...sprintFieldIds,
    ...epicLinkIds,
    ...startDateIds,
    ...excluded,
  ]);
  const customFields: Array<{ key: string; value: unknown }> = [];
  for (const [id, value] of Object.entries(fields)) {
    if (!id.startsWith("customfield_") || special.has(id) || isEmpty(value))
      continue;
    const name = names.get(id);
    if (name && IGNORED_CUSTOM_NAMES.has(name.toLowerCase())) continue;
    addFacet({ domain: "custom_field", value: id }, name ?? id);
    const scalar = customFieldScalar(value);
    if (scalar === undefined) pushLoss(losses, "custom_field_value_unreadable");
    else customFields.push({ key: id, value: scalar });
  }

  // People.
  const assignee = asObject(fields.assignee);
  const reporter = asObject(fields.reporter) ?? asObject(fields.creator);
  const assigneeEmail = emailOf(assignee);
  const authorEmail = emailOf(reporter);
  if (assignee && !assigneeEmail)
    pushLoss(losses, "person_email_unavailable", "assignee");
  if (reporter && !authorEmail)
    pushLoss(losses, "person_email_unavailable", "author");

  // Dates.
  const created = toIso(fields.created);
  if (asString(fields.created) && !created)
    pushLoss(losses, "timestamp_invalid", "created");
  const dueDate = toIso(fields.duedate);

  // Description.
  const description = descriptionToText(fields.description);
  if (description.lossy) pushLoss(losses, "rich_text_lossy", "description");
  const environment = descriptionToText(fields.environment);
  if (environment.text) pushLoss(losses, "environment_not_imported");

  // Comments.
  const commentBlock = asObject(fields.comment);
  const comments: NormalizedComment[] = [];
  for (const item of asArray(commentBlock?.comments)) {
    const comment = asObject(item);
    if (!comment) continue;
    const body = descriptionToText(comment.body);
    const visibility = commentVisibility(comment);
    comments.push({
      id: String(comment.id ?? comments.length),
      authorEmail: emailOf(comment.author),
      visibility,
      createdAt: toIso(comment.created),
      body: body.text,
    });
    if (body.lossy) pushLoss(losses, "rich_text_lossy", "comment");
  }
  const commentTotal = Number(commentBlock?.total);
  if (Number.isFinite(commentTotal) && commentTotal > comments.length)
    pushLoss(losses, "comment_truncated");

  // Attachments (metadata only; downloading is the writer lane's job).
  const attachments: NormalizedAttachment[] = [];
  for (const item of asArray(fields.attachment)) {
    const attachment = asObject(item);
    const filename = asString(attachment?.filename);
    if (!attachment || !filename) continue;
    attachments.push({
      id: String(attachment.id ?? attachments.length),
      filename,
      size: Number.isFinite(Number(attachment.size))
        ? Number(attachment.size)
        : undefined,
      mimeType: asString(attachment.mimeType),
      url: asString(attachment.content),
      createdAt: toIso(attachment.created),
      authorEmail: emailOf(attachment.author),
    });
  }

  // Issue links.
  const links: NormalizedLink[] = [];
  for (const item of asArray(fields.issuelinks)) {
    const link = asObject(item);
    if (!link) continue;
    const type = asString(asObject(link.type)?.name) ?? "Relates";
    const outward = asString(asObject(link.outwardIssue)?.key);
    const inward = asString(asObject(link.inwardIssue)?.key);
    if (outward) links.push({ type, direction: "outward", targetKey: outward });
    if (inward) links.push({ type, direction: "inward", targetKey: inward });
  }
  const relations: NonNullable<SourceRecord["relations"]> = [];
  for (const link of links) {
    const mapped = JIRA_LINK_TYPES[link.type.toLowerCase()];
    if (!mapped) {
      pushLoss(losses, "link_type_unsupported");
      continue;
    }
    const type = link.direction === "outward" ? mapped.outward : mapped.inward;
    if (type === "skip") continue;
    relations.push({
      type,
      target: { sourceType: JIRA_SOURCE_TYPE, sourceId: link.targetKey },
    });
  }

  // Worklog.
  const worklogBlock = asObject(fields.worklog);
  const worklogs: NormalizedWorklog[] = [];
  for (const item of asArray(worklogBlock?.worklogs)) {
    const worklog = asObject(item);
    const seconds = Number(worklog?.timeSpentSeconds);
    if (!worklog || !Number.isFinite(seconds)) continue;
    worklogs.push({
      authorEmail: emailOf(worklog.author),
      startedAt: toIso(worklog.started),
      seconds,
    });
  }
  if (worklogs.length > 0) pushLoss(losses, "worklog_not_imported");
  const worklogTotal = Number(worklogBlock?.total);
  if (Number.isFinite(worklogTotal) && worklogTotal > worklogs.length)
    pushLoss(losses, "worklog_truncated");

  // Changelog (history).
  const changelog = asObject(raw.changelog);
  const histories = asArray(changelog?.histories);
  const history: NonNullable<SourceRecord["history"]> = [];
  for (const entry of histories) {
    const object = asObject(entry);
    const at = toIso(object?.created);
    const author = asObject(object?.author);
    const authorEmail = emailOf(author);
    const authorName = asString(author?.displayName)?.slice(0, 200);
    for (const item of asArray(object?.items)) {
      const change = asObject(item);
      const field = asString(change?.field)
        ?.toLowerCase()
        .replace(/[^a-z0-9]+/gu, "_")
        .replace(/^_+|_+$/gu, "")
        .slice(0, 120);
      if (!at || !field) {
        pushLoss(losses, "history_entry_unreadable");
        continue;
      }
      history.push({
        sourceId: `${String(object?.id ?? history.length)}:${field}`.slice(
          0,
          512,
        ),
        at,
        ...(authorEmail ? { authorEmail } : {}),
        ...(authorName ? { authorName } : {}),
        field,
        from: asString(change?.fromString)?.slice(0, 2000) ?? null,
        to: asString(change?.toString)?.slice(0, 2000) ?? null,
      });
    }
  }
  const changelogTotal = Number(changelog?.total);
  if (Number.isFinite(changelogTotal) && changelogTotal > histories.length)
    pushLoss(losses, "changelog_truncated");

  // Other data the record contract has no field for.
  if (asArray(fields.fixVersions).length + asArray(fields.versions).length > 0)
    pushLoss(losses, "version_not_imported");
  if (
    Number(fields.timeoriginalestimate) > 0 ||
    Number(fields.timeestimate) > 0 ||
    Number(asObject(fields.timetracking)?.originalEstimateSeconds) > 0
  )
    pushLoss(losses, "time_estimate_not_imported");
  if (asObject(fields.security))
    pushLoss(losses, "security_level_not_imported");
  if (Number(asObject(fields.watches)?.watchCount) > 0)
    pushLoss(losses, "watcher_not_imported");

  // Title.
  let title = asString(fields.summary)?.trim();
  if (!title) {
    title = key;
    pushLoss(losses, "title_missing");
  }

  // Source URL: https site origin only.
  let sourceUrl: string | undefined;
  if (options.siteUrl && key) {
    try {
      const url = new URL(options.siteUrl);
      if (url.protocol === "https:" && !url.username && !url.password)
        sourceUrl = `${url.origin}/browse/${encodeURIComponent(key)}`;
    } catch {
      sourceUrl = undefined;
    }
  }

  const structuredComments: NonNullable<SourceRecord["comments"]> = comments
    .filter((comment) => comment.body.trim() !== "")
    .map((comment) => ({
      sourceId: comment.id,
      ...(comment.authorEmail ? { authorEmail: comment.authorEmail } : {}),
      ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
      visibility: comment.visibility,
      body: comment.body.slice(0, 100_000),
    }));
  const structuredAttachments: NonNullable<SourceRecord["attachments"]> =
    attachments.flatMap((attachment) =>
      attachment.url
        ? [
            {
              sourceId: attachment.id,
              url: attachment.url,
              filename: attachment.filename
                .replace(/[\\/]/gu, "_")
                .slice(0, 255),
              ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
              ...(attachment.size !== undefined && attachment.size >= 0
                ? { size: Math.trunc(attachment.size) }
                : {}),
              ...(attachment.createdAt
                ? { createdAt: attachment.createdAt }
                : {}),
              ...(attachment.authorEmail
                ? { authorEmail: attachment.authorEmail }
                : {}),
            },
          ]
        : [],
    );
  if (attachments.length > structuredAttachments.length)
    pushLoss(losses, "attachment_url_missing");
  const updated = toIso(fields.updated);
  const resolved = toIso(fields.resolutiondate);
  const reporterName = asString(reporter?.displayName)?.slice(0, 200);
  const record: SourceRecord = {
    sourceType: JIRA_SOURCE_TYPE,
    sourceId: key,
    ...(sourceUrl ? { sourceUrl } : {}),
    title,
    ...(description.text ? { description: description.text } : {}),
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(created ? { sourceCreatedAt: created } : {}),
    ...(updated ? { sourceUpdatedAt: updated } : {}),
    ...(resolved ? { sourceResolvedAt: resolved } : {}),
    ...(authorEmail ? { sourceAuthorEmail: authorEmail } : {}),
    ...(reporterName ? { sourceAuthorName: reporterName } : {}),
    ...(assigneeEmail ? { assigneeEmail } : {}),
    ...(parentSourceId ? { parentSourceId } : {}),
    facets,
    ...(structuredComments.length ? { comments: structuredComments } : {}),
    ...(structuredAttachments.length
      ? { attachments: structuredAttachments }
      : {}),
    ...(relations.length ? { relations } : {}),
    ...(history.length ? { history } : {}),
    ...(customFields.length ? { customFields } : {}),
    ...(losses.length > 0 ? { losses } : {}),
  };
  return {
    key,
    record,
    facetLabels,
    comments,
    attachments,
    links,
    worklogs,
    changelogEntries: histories.length,
  };
}
