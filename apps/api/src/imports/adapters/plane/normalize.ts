/**
 * Plane issue -> normalised source record, role proposals and pages (pure).
 */
import type {
  LossInput,
  SourceFacet,
  SourceRecord,
  StateGroup,
} from "../../engine/adapter";
import { STATE_GROUPS } from "../../engine/adapter";
import {
  asArray,
  htmlToText,
  isoDate,
  isRecord,
  num,
  safeHttpsUrl,
  str,
  stripControl,
} from "../azure-devops/http";
import { RECORD_LIMITS } from "../azure-devops/types";

export type PlaneMember = {
  id: string;
  email?: string;
  name?: string;
  role?: number;
};

export type PlaneLookups = {
  members: ReadonlyMap<string, PlaneMember>;
  /** state id -> { name, group } */
  states: ReadonlyMap<string, { name: string; group: string }>;
  labels: ReadonlyMap<string, string>;
  types: ReadonlyMap<string, string>;
  /** issue id -> cycle name / module names */
  cycleOf: ReadonlyMap<string, string>;
  modulesOf: ReadonlyMap<string, string[]>;
};

export type PlaneProjectRef = { id: string; identifier: string; name: string };

export type PlaneIssueContext = {
  slug: string;
  webUrl: string;
  project: PlaneProjectRef;
  lookups: PlaneLookups;
  comments?: unknown[];
  attachments?: unknown[];
  relations?: unknown;
  activities?: unknown[];
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

export function parseMember(value: unknown): PlaneMember | null {
  if (!isRecord(value)) return null;
  // Workspace members are sometimes wrapped as `{ member: {...}, role }`.
  const inner = isRecord(value.member) ? value.member : value;
  const id = str(inner.id) ?? str(inner.member_id);
  if (!id) return null;
  const email = str(inner.email);
  const name = str(inner.display_name) ?? str(inner.first_name);
  const role = num(value.role) ?? num(inner.role);
  return {
    id,
    ...(email && EMAIL.test(email) ? { email } : {}),
    ...(name ? { name } : {}),
    ...(role !== undefined ? { role } : {}),
  };
}

export function stateFacetValue(
  identifier: string,
  stateName: string,
  group: string,
): string {
  return `${identifier}/${stateName} (${group})`;
}

export function groupOfStateFacet(value: string): StateGroup | null {
  const match = /\((\w+)\)$/u.exec(value);
  const group = match?.[1];
  return group && (STATE_GROUPS as readonly string[]).includes(group)
    ? (group as StateGroup)
    : null;
}

/** Plane's own priority vocabulary; `none` is Medium by contract (a proposal, never silent). */
export const PLANE_PRIORITY: Record<
  string,
  { value: "urgent" | "high" | "medium" | "low"; exact: boolean }
> = {
  urgent: { value: "urgent", exact: true },
  high: { value: "high", exact: true },
  medium: { value: "medium", exact: true },
  low: { value: "low", exact: true },
  none: { value: "medium", exact: false },
};

const RELATION_KEYS: Array<
  [string, "relates" | "blocks" | "duplicates" | "precedes" | "requires"]
> = [
  ["blocking", "blocks"],
  ["blocked_by", "requires"],
  ["duplicate", "duplicates"],
  ["relates_to", "relates"],
  ["start_before", "precedes"],
  ["finish_before", "precedes"],
  ["start_after", "requires"],
  ["finish_after", "requires"],
];

const HISTORY_FIELDS: Record<string, string> = {
  name: "title",
  state: "state",
  priority: "priority",
  assignees: "assignee",
  labels: "labels",
  parent: "parent",
  start_date: "start_date",
  target_date: "due_date",
  estimate_point: "estimate",
  cycles: "cycle",
  modules: "module",
};

export function issueFacets(
  issue: Record<string, unknown>,
  ctx: Pick<PlaneIssueContext, "project" | "lookups">,
): SourceFacet[] {
  const facets: SourceFacet[] = [];
  const { lookups, project } = ctx;
  const typeId = str(issue.type) ?? str(issue.type_id);
  facets.push({
    domain: "type",
    value: (typeId && lookups.types.get(typeId)) || "Issue",
  });
  const state = lookups.states.get(
    str(issue.state) ?? str(issue.state_id) ?? "",
  );
  if (state)
    facets.push({
      domain: "state",
      value: stateFacetValue(project.identifier, state.name, state.group),
    });
  facets.push({
    domain: "priority",
    value: str(issue.priority) ?? "none",
  });
  for (const labelId of asArray(issue.labels)) {
    const name =
      typeof labelId === "string" ? lookups.labels.get(labelId) : undefined;
    if (name) facets.push({ domain: "label", value: name });
  }
  const id = str(issue.id) ?? "";
  const cycle = lookups.cycleOf.get(id);
  if (cycle)
    facets.push({ domain: "cycle", value: `${project.identifier}/${cycle}` });
  for (const name of lookups.modulesOf.get(id) ?? [])
    facets.push({ domain: "module", value: `${project.identifier}/${name}` });
  if (
    issue.estimate_point !== null &&
    issue.estimate_point !== undefined &&
    String(issue.estimate_point) !== ""
  )
    facets.push({ domain: "custom_field", value: "estimate_point" });
  return facets;
}

const memberEmail = (lookups: PlaneLookups, id: unknown) =>
  typeof id === "string" ? lookups.members.get(id) : undefined;

export function toRecord(
  issue: Record<string, unknown>,
  ctx: PlaneIssueContext,
): SourceRecord | null {
  const id = str(issue.id);
  const title = str(issue.name);
  if (!id || !title) return null;
  const { lookups, project } = ctx;
  const losses: LossInput[] = [];
  const addLoss = (code: string, detailCode?: string) => {
    if (!losses.some((l) => l.code === code && l.detailCode === detailCode))
      losses.push({ code, ...(detailCode ? { detailCode } : {}) });
  };

  const assigneeIds = asArray(issue.assignees).filter(
    (value): value is string => typeof value === "string",
  );
  const assignee = memberEmail(lookups, assigneeIds[0]);
  if (assigneeIds[0] && !assignee?.email) addLoss("assignee_email_unavailable");
  if (assigneeIds.length > 1) addLoss("assignee_extra_dropped");
  const author = memberEmail(lookups, issue.created_by);

  let description: string | undefined;
  const html = str(issue.description_html);
  if (html && html !== "<p></p>") {
    const converted = htmlToText(html);
    if (converted.text) description = converted.text;
    if (converted.lossy) addLoss("rich_text_lossy", "description");
  } else if (str(issue.description_stripped)) {
    description = str(issue.description_stripped);
  }

  const url = safeHttpsUrl(
    `${ctx.webUrl}/${encodeURIComponent(ctx.slug)}/projects/${encodeURIComponent(project.id)}/issues/${encodeURIComponent(id)}`,
  );

  const comments: NonNullable<SourceRecord["comments"]> = [];
  for (const raw of ctx.comments ?? []) {
    if (!isRecord(raw)) continue;
    const cid = str(raw.id);
    const rawHtml = str(raw.comment_html);
    const body = rawHtml
      ? htmlToText(rawHtml)
      : { text: str(raw.comment_stripped) ?? "", lossy: false };
    if (!cid || !body.text) continue;
    if (body.lossy) addLoss("rich_text_lossy", "comment");
    const who = memberEmail(lookups, raw.actor ?? raw.created_by);
    const created = isoDate(raw.created_at);
    const updated = isoDate(raw.updated_at);
    comments.push({
      sourceId: cid,
      ...(who?.email ? { authorEmail: who.email } : {}),
      ...(who?.name ? { authorName: who.name } : {}),
      ...(created ? { createdAt: created } : {}),
      ...(updated ? { updatedAt: updated } : {}),
      // Plane has no public/internal distinction: internal is the safe default, stated explicitly.
      visibility: "internal",
      body: body.text.slice(0, 100_000),
    });
  }

  const attachments: NonNullable<SourceRecord["attachments"]> = [];
  for (const raw of ctx.attachments ?? []) {
    if (!isRecord(raw)) continue;
    const aid = str(raw.id);
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    const name = str(attributes.name);
    const asset = str(raw.asset);
    let absolute: string | undefined;
    try {
      absolute = asset ? new URL(asset, ctx.webUrl).toString() : undefined;
    } catch {
      absolute = undefined;
    }
    const safe = safeHttpsUrl(absolute);
    if (!aid || !name || !safe) {
      addLoss("attachment_metadata_invalid");
      continue;
    }
    const size = num(attributes.size);
    const mime = str(attributes.type);
    const created = isoDate(raw.created_at);
    const who = memberEmail(lookups, raw.created_by);
    attachments.push({
      sourceId: aid,
      url: safe,
      filename:
        stripControl(name.replace(/[\\/]/gu, "_")).slice(0, 255) ||
        "attachment",
      ...(mime ? { mimeType: mime.slice(0, 200) } : {}),
      ...(size !== undefined && size >= 0 ? { size: Math.trunc(size) } : {}),
      ...(who?.email ? { authorEmail: who.email } : {}),
      ...(created ? { createdAt: created } : {}),
    });
  }

  const relations: NonNullable<SourceRecord["relations"]> = [];
  const rel = isRecord(ctx.relations) ? ctx.relations : {};
  for (const [key, type] of RELATION_KEYS) {
    for (const target of asArray(rel[key])) {
      const targetId =
        typeof target === "string"
          ? target
          : isRecord(target)
            ? str(target.id)
            : undefined;
      if (targetId)
        relations.push({
          type,
          target: { sourceType: "issue", sourceId: targetId },
        });
    }
  }

  const history: NonNullable<SourceRecord["history"]> = [];
  for (const raw of ctx.activities ?? []) {
    if (!isRecord(raw)) continue;
    const field = str(raw.field);
    const at = isoDate(raw.created_at);
    const aid = str(raw.id);
    if (!field || !at || !aid) continue;
    const mapped = HISTORY_FIELDS[field];
    if (!mapped) {
      addLoss("revision_not_imported");
      continue;
    }
    const who = memberEmail(lookups, raw.actor);
    const scalar = (value: unknown) =>
      value === null || value === undefined
        ? null
        : String(value).slice(0, 2000);
    history.push({
      sourceId: aid,
      at,
      ...(who?.email ? { authorEmail: who.email } : {}),
      ...(who?.name ? { authorName: who.name } : {}),
      field: mapped,
      from: scalar(raw.old_value),
      to: scalar(raw.new_value),
    });
  }

  const customFields: NonNullable<SourceRecord["customFields"]> = [];
  if (
    issue.estimate_point !== null &&
    issue.estimate_point !== undefined &&
    String(issue.estimate_point) !== ""
  )
    customFields.push({
      key: "estimate_point",
      value: String(issue.estimate_point),
    });

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

  const parent = str(issue.parent);
  const start = isoDate(issue.start_date);
  const due = isoDate(issue.target_date);
  const created = isoDate(issue.created_at);
  const updated = isoDate(issue.updated_at);
  const resolved = isoDate(issue.completed_at);
  return {
    sourceType: "issue",
    sourceId: id,
    ...(url ? { sourceUrl: url } : {}),
    title: title.slice(0, 500),
    ...(description ? { description } : {}),
    ...(start ? { startDate: start } : {}),
    ...(due ? { dueDate: due } : {}),
    ...(created ? { sourceCreatedAt: created } : {}),
    ...(updated ? { sourceUpdatedAt: updated } : {}),
    ...(resolved ? { sourceResolvedAt: resolved } : {}),
    ...(author?.email ? { sourceAuthorEmail: author.email } : {}),
    ...(author?.name ? { sourceAuthorName: author.name } : {}),
    ...(assignee?.email ? { assigneeEmail: assignee.email } : {}),
    ...(parent ? { parentSourceId: parent } : {}),
    facets: issueFacets(issue, ctx),
    ...(comments.length ? { comments } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(relations.length ? { relations } : {}),
    ...(customFields.length ? { customFields } : {}),
    ...(history.length ? { history } : {}),
    ...(losses.length ? { losses } : {}),
  };
}

export type RoleProposal = {
  email: string;
  sourceRole: number;
  proposedRole: "admin" | "member" | "viewer" | null;
  /** Always true: roles are an access decision and are never accepted without a person. */
  requiresReview: true;
  /** Never confirmed by the adapter. */
  confirmed: false;
  /** Guest: a Plane guest can often comment, a TaskDesk viewer cannot. */
  note?: "guest_can_comment_in_plane";
};

/**
 * Admin 20 / Member 15 / Guest 5 -> Admin / Member / Viewer. Proposals only: every row requires
 * human review (the engine has no role mapping domain yet, so this is not part of the run).
 */
export function proposePlaneRoles(
  members: readonly PlaneMember[],
): RoleProposal[] {
  const out: RoleProposal[] = [];
  for (const member of members) {
    if (!member.email || member.role === undefined) continue;
    const proposedRole =
      member.role === 20
        ? "admin"
        : member.role === 15
          ? "member"
          : member.role === 5
            ? "viewer"
            : null;
    out.push({
      email: member.email,
      sourceRole: member.role,
      proposedRole,
      requiresReview: true,
      confirmed: false,
      ...(member.role === 5
        ? { note: "guest_can_comment_in_plane" as const }
        : {}),
    });
  }
  return out;
}

export type PlanePage = {
  sourceId: string;
  projectIdentifier: string;
  title: string;
  text: string;
  lossyRichText: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** Pages are always imported unpublished and staff-only, whatever Plane's access was. */
  published: false;
  visibility: "staff";
  sourceAccess: "public" | "private" | "unknown";
};

export function toPage(
  raw: unknown,
  projectIdentifier: string,
): PlanePage | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const title = str(raw.name) ?? str(raw.title);
  if (!id || !title) return null;
  const html = str(raw.description_html) ?? "";
  const converted = htmlToText(html);
  const access = num(raw.access);
  const created = isoDate(raw.created_at);
  const updated = isoDate(raw.updated_at);
  return {
    sourceId: id,
    projectIdentifier,
    title: title.slice(0, 500),
    text: converted.text,
    lossyRichText: converted.lossy,
    ...(created ? { createdAt: created } : {}),
    ...(updated ? { updatedAt: updated } : {}),
    published: false,
    visibility: "staff",
    sourceAccess:
      access === 0 ? "public" : access === 1 ? "private" : "unknown",
  };
}
