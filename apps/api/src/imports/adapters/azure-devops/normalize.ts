/**
 * Azure DevOps work item -> normalised source record (pure). All inputs are untyped source JSON.
 */
import type {
  LossInput,
  SourceFacet,
  SourceRecord,
} from "../../engine/adapter";
import {
  asArray,
  htmlToText,
  isoDate,
  isRecord,
  num,
  safeHttpsUrl,
  str,
  stripControl,
} from "./http";
import {
  ADO_ATTACHMENT_LINK,
  ADO_CHILD_LINK,
  ADO_HISTORY_FIELDS,
  ADO_LINK_RELATIONS,
  ADO_PARENT_LINK,
  areaModule,
  stateFacetValue,
} from "./mapping";
import { RECORD_LIMITS } from "./types";

export type AdoIdentity = { email?: string; name?: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

/** ADO identity refs carry the sign-in address in `uniqueName`; legacy strings are `Name <email>`. */
export function identity(value: unknown): AdoIdentity {
  if (isRecord(value)) {
    const unique = str(value.uniqueName);
    const name = str(value.displayName);
    const email = unique && EMAIL.test(unique) ? unique : undefined;
    return { ...(email ? { email } : {}), ...(name ? { name } : {}) };
  }
  if (typeof value === "string") {
    const match = /^(.*?)\s*<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>\s*$/u.exec(
      value,
    );
    if (match) {
      const name = match[1]?.trim();
      return { email: match[2] as string, ...(name ? { name } : {}) };
    }
    return value.trim() ? { name: value.trim() } : {};
  }
  return {};
}

const idFromUrl = (url: string | undefined): number | undefined => {
  const match = url ? /\/(\d+)(?:\?.*)?$/u.exec(url) : null;
  return match ? Number(match[1]) : undefined;
};

const cleanName = (value: string): string =>
  stripControl(value.replace(/[\\/]/gu, "_")).slice(0, 255);

export type AdoItemContext = {
  /** `https://dev.azure.com/{org}` (no trailing slash). */
  baseUrl: string;
  process: string;
  comments?: unknown[];
  updates?: unknown[];
};

const SKIPPED_BOOKKEEPING = new Set([
  "System.Rev",
  "System.ChangedDate",
  "System.ChangedBy",
  "System.AuthorizedDate",
  "System.AuthorizedAs",
  "System.RevisedDate",
  "System.Watermark",
  "System.PersonId",
  "System.CommentCount",
  "System.History",
  "System.NodeName",
  "System.AreaId",
  "System.IterationId",
  "System.StateChangeDate",
  "System.BoardColumn",
  "System.BoardColumnDone",
  "Microsoft.VSTS.Common.StateChangeDate",
  "Microsoft.VSTS.Common.ActivatedDate",
  "Microsoft.VSTS.Common.ActivatedBy",
  "Microsoft.VSTS.Common.ResolvedDate",
  "Microsoft.VSTS.Common.ResolvedBy",
  "Microsoft.VSTS.Common.ClosedDate",
  "Microsoft.VSTS.Common.ClosedBy",
]);

const CUSTOM_FIELD_NAMES: Record<string, string> = {
  "Microsoft.VSTS.Common.Severity": "Severity",
  "Microsoft.VSTS.Scheduling.StoryPoints": "Story Points",
  "Microsoft.VSTS.Scheduling.Effort": "Effort",
  "Microsoft.VSTS.Scheduling.Size": "Size",
  "Microsoft.VSTS.Scheduling.OriginalEstimate": "Original Estimate",
  "Microsoft.VSTS.Scheduling.RemainingWork": "Remaining Work",
  "Microsoft.VSTS.Scheduling.CompletedWork": "Completed Work",
};

/** Custom field key for a source field reference name, or null when it is a core field. */
export function customFieldKey(referenceName: string): string | null {
  const known = CUSTOM_FIELD_NAMES[referenceName];
  if (known) return known;
  return referenceName.startsWith("System.") ||
    referenceName.startsWith("Microsoft.")
    ? null
    : referenceName;
}

const scalar = (value: unknown): string | number | boolean | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (isRecord(value)) {
    const who = identity(value);
    return (who.email ?? who.name ?? "").slice(0, 2000) || null;
  }
  return String(value).slice(0, 2000);
};

/** Facets for discovery and the record. State is scoped by process. */
export function itemFacets(
  fields: Record<string, unknown>,
  process: string,
): SourceFacet[] {
  const facets: SourceFacet[] = [];
  const type = str(fields["System.WorkItemType"]);
  if (type) facets.push({ domain: "type", value: type });
  const state = str(fields["System.State"]);
  if (state)
    facets.push({ domain: "state", value: stateFacetValue(process, state) });
  const priority = fields["Microsoft.VSTS.Common.Priority"];
  if (priority !== undefined && priority !== null && String(priority) !== "")
    facets.push({ domain: "priority", value: String(priority) });
  for (const tag of (str(fields["System.Tags"]) ?? "").split(";")) {
    const trimmed = tag.trim();
    if (trimmed) facets.push({ domain: "label", value: trimmed });
  }
  const area = areaModule(str(fields["System.AreaPath"]));
  if (area) facets.push({ domain: "module", value: area });
  const iteration = str(fields["System.IterationPath"]);
  if (iteration && iteration.split("\\").filter(Boolean).length >= 2)
    facets.push({ domain: "cycle", value: iteration });
  const seen = new Set<string>();
  for (const key of Object.keys(fields)) {
    const custom = customFieldKey(key);
    if (
      custom &&
      !seen.has(custom) &&
      fields[key] !== null &&
      fields[key] !== undefined
    ) {
      seen.add(custom);
      facets.push({ domain: "custom_field", value: custom });
    }
  }
  return facets;
}

export function toRecord(
  item: Record<string, unknown>,
  ctx: AdoItemContext,
): SourceRecord | null {
  const fields = isRecord(item.fields) ? item.fields : {};
  const id = num(item.id) ?? num(fields["System.Id"]);
  const title = str(fields["System.Title"]);
  const project = str(fields["System.TeamProject"]);
  if (id === undefined || !title) return null;
  const losses: LossInput[] = [];
  const addLoss = (code: string, detailCode?: string) => {
    if (!losses.some((l) => l.code === code && l.detailCode === detailCode))
      losses.push({ code, ...(detailCode ? { detailCode } : {}) });
  };

  const assignee = identity(fields["System.AssignedTo"]);
  const creator = identity(fields["System.CreatedBy"]);
  if (fields["System.AssignedTo"] && !assignee.email)
    addLoss("assignee_email_unavailable");
  if (fields["System.CreatedBy"] && !creator.email)
    addLoss("author_email_unavailable");

  let description: string | undefined;
  const html = str(fields["System.Description"]);
  if (html) {
    const converted = htmlToText(html);
    if (converted.text) description = converted.text;
    if (converted.lossy) addLoss("rich_text_lossy", "description");
  }

  const url = safeHttpsUrl(
    project
      ? `${ctx.baseUrl}/${encodeURIComponent(project)}/_workitems/edit/${id}`
      : undefined,
  );
  const startDate = isoDate(fields["Microsoft.VSTS.Scheduling.StartDate"]);
  const dueDate = isoDate(
    fields["Microsoft.VSTS.Scheduling.TargetDate"] ??
      fields["Microsoft.VSTS.Scheduling.DueDate"],
  );

  let parentSourceId: string | undefined;
  const relations: NonNullable<SourceRecord["relations"]> = [];
  const attachments: NonNullable<SourceRecord["attachments"]> = [];
  for (const entry of asArray(item.relations)) {
    if (!isRecord(entry)) continue;
    const rel = str(entry.rel);
    const relUrl = str(entry.url);
    const attributes = isRecord(entry.attributes) ? entry.attributes : {};
    if (rel === ADO_PARENT_LINK) {
      const parent = idFromUrl(relUrl);
      if (parent !== undefined && !parentSourceId)
        parentSourceId = String(parent);
      continue;
    }
    if (rel === ADO_CHILD_LINK) continue; // the child carries its own parent link
    if (rel === ADO_ATTACHMENT_LINK) {
      const safe = safeHttpsUrl(relUrl);
      const name = str(attributes.name);
      if (!safe || !name) {
        addLoss("attachment_metadata_invalid");
        continue;
      }
      const guid = /\/attachments\/([0-9a-f-]{36})/iu.exec(relUrl ?? "")?.[1];
      const size = num(attributes.resourceSize);
      const created = isoDate(attributes.resourceCreatedDate);
      attachments.push({
        sourceId: guid ?? safe,
        url: safe,
        filename: cleanName(name),
        ...(size !== undefined && size >= 0 ? { size: Math.trunc(size) } : {}),
        ...(created ? { createdAt: created } : {}),
      });
      continue;
    }
    const mapped = rel ? ADO_LINK_RELATIONS[rel] : undefined;
    const target = idFromUrl(relUrl);
    if (!mapped || target === undefined) {
      addLoss(
        "relation_type_unsupported",
        rel === "ArtifactLink"
          ? "artifact_link"
          : rel === "Hyperlink"
            ? "hyperlink"
            : "other",
      );
      continue;
    }
    if (mapped === "skip") continue;
    relations.push({
      type: mapped,
      target: { sourceType: "work_item", sourceId: String(target) },
    });
  }

  const comments: NonNullable<SourceRecord["comments"]> = [];
  for (const raw of ctx.comments ?? []) {
    if (!isRecord(raw)) continue;
    const text = str(raw.text);
    const cid = raw.id;
    if (!text || (typeof cid !== "number" && typeof cid !== "string")) continue;
    const converted = htmlToText(text);
    if (!converted.text) continue;
    if (converted.lossy) addLoss("rich_text_lossy", "comment");
    const who = identity(raw.createdBy);
    const created = isoDate(raw.createdDate);
    const updated = isoDate(raw.modifiedDate);
    comments.push({
      sourceId: String(cid),
      ...(who.email ? { authorEmail: who.email } : {}),
      ...(who.name ? { authorName: who.name } : {}),
      ...(created ? { createdAt: created } : {}),
      ...(updated ? { updatedAt: updated } : {}),
      // ADO has no public/internal distinction; internal is the safe default (stated explicitly).
      visibility: "internal",
      body: converted.text.slice(0, 100_000),
    });
  }

  const history: NonNullable<SourceRecord["history"]> = [];
  for (const raw of ctx.updates ?? []) {
    if (!isRecord(raw)) continue;
    const rev = num(raw.rev);
    const changed = isRecord(raw.fields) ? raw.fields : {};
    if (rev === 1) continue; // the creation revision is not a change
    const at = isoDate(raw.revisedDate);
    const who = identity(raw.revisedBy);
    for (const [reference, change] of Object.entries(changed)) {
      if (SKIPPED_BOOKKEEPING.has(reference) || !isRecord(change)) continue;
      const field = ADO_HISTORY_FIELDS[reference];
      if (!field || !at) {
        addLoss("revision_not_imported");
        continue;
      }
      history.push({
        sourceId: `${String(raw.id ?? rev ?? history.length)}:${reference}`,
        at,
        ...(who.email ? { authorEmail: who.email } : {}),
        ...(who.name ? { authorName: who.name } : {}),
        field,
        from: scalar(change.oldValue),
        to: scalar(change.newValue),
      });
    }
  }

  const customFields: NonNullable<SourceRecord["customFields"]> = [];
  for (const [reference, value] of Object.entries(fields)) {
    const key = customFieldKey(reference);
    if (key && value !== null && value !== undefined)
      customFields.push({ key, value: scalar(value) });
  }

  const caps = RECORD_LIMITS;
  if (comments.length > caps.comments) {
    addLoss("comments_over_limit");
    comments.length = caps.comments;
  }
  if (attachments.length > caps.attachments) {
    addLoss("attachments_over_limit");
    attachments.length = caps.attachments;
  }
  if (relations.length > caps.relations) {
    addLoss("relations_over_limit");
    relations.length = caps.relations;
  }
  if (history.length > caps.history) {
    addLoss("history_over_limit");
    history.length = caps.history;
  }
  if (customFields.length > caps.customFields) {
    addLoss("custom_fields_over_limit");
    customFields.length = caps.customFields;
  }

  const created = isoDate(fields["System.CreatedDate"]);
  const updated = isoDate(fields["System.ChangedDate"]);
  const resolved = isoDate(
    fields["Microsoft.VSTS.Common.ResolvedDate"] ??
      fields["Microsoft.VSTS.Common.ClosedDate"],
  );
  return {
    sourceType: "work_item",
    sourceId: String(id),
    ...(url ? { sourceUrl: url } : {}),
    title: title.slice(0, 500),
    ...(description ? { description } : {}),
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(created ? { sourceCreatedAt: created } : {}),
    ...(updated ? { sourceUpdatedAt: updated } : {}),
    ...(resolved ? { sourceResolvedAt: resolved } : {}),
    ...(creator.email ? { sourceAuthorEmail: creator.email } : {}),
    ...(creator.name ? { sourceAuthorName: creator.name } : {}),
    ...(assignee.email ? { assigneeEmail: assignee.email } : {}),
    ...(parentSourceId ? { parentSourceId } : {}),
    facets: itemFacets(fields, ctx.process),
    ...(comments.length ? { comments } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(relations.length ? { relations } : {}),
    ...(customFields.length ? { customFields } : {}),
    ...(history.length ? { history } : {}),
    ...(losses.length ? { losses } : {}),
  };
}
