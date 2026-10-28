/**
 * Azure DevOps CSV export mode (last resort). A query export carries fields only, so every record
 * is reported with explicit loss codes for what CSV cannot carry: history, comments, attachments,
 * relations (and the parent when the export has no Parent column). Pure; no network.
 */
import type { LossInput, SourceRecord } from "../../engine/adapter";
import { htmlToText, isoDate, safeHttpsUrl } from "./http";
import { CSV_PROCESS, stateFacetValue } from "./mapping";
import { identity, itemFacets } from "./normalize";

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF/LF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

const COLUMN: Record<string, string> = {
  id: "id",
  "work item type": "type",
  title: "title",
  "assigned to": "assignee",
  state: "state",
  tags: "tags",
  "area path": "area",
  "iteration path": "iteration",
  priority: "priority",
  description: "description",
  "story points": "story_points",
  effort: "effort",
  severity: "severity",
  "created date": "created",
  "changed date": "changed",
  "created by": "createdBy",
  "team project": "project",
  parent: "parent",
  "start date": "start",
  "target date": "due",
  "due date": "due",
};

export type CsvRead = {
  records: SourceRecord[];
  /** Rows that could not become a record (missing id/title/type/state). */
  skippedRows: number;
};

export function csvRecords(text: string, baseUrl: string): CsvRead {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return { records: [], skippedRows: 0 };
  const index = new Map<string, number>();
  header.forEach((name, position) => {
    const key = COLUMN[name.trim().toLowerCase()];
    if (key && !index.has(key)) index.set(key, position);
  });
  const hasParentColumn = index.has("parent");
  const records: SourceRecord[] = [];
  const seen = new Set<string>();
  let skippedRows = 0;
  for (const row of rows.slice(1)) {
    const get = (key: string) => {
      const position = index.get(key);
      return position === undefined ? "" : (row[position] ?? "").trim();
    };
    const id = get("id");
    const title = get("title");
    const type = get("type");
    const state = get("state");
    if (!/^\d+$/u.test(id) || !title || !type || !state || seen.has(id)) {
      skippedRows += 1;
      continue;
    }
    seen.add(id);
    const losses: LossInput[] = [
      { code: "csv_history_unavailable" },
      { code: "csv_comments_unavailable" },
      { code: "csv_attachments_unavailable" },
      { code: "csv_relations_unavailable" },
    ];
    if (!hasParentColumn) losses.push({ code: "csv_parent_unavailable" });
    const fields: Record<string, unknown> = {
      "System.WorkItemType": type,
      "System.State": state,
      "System.Tags": get("tags"),
      "System.AreaPath": get("area"),
      "System.IterationPath": get("iteration"),
      "Microsoft.VSTS.Common.Priority": get("priority"),
    };
    if (get("severity"))
      fields["Microsoft.VSTS.Common.Severity"] = get("severity");
    if (get("story_points"))
      fields["Microsoft.VSTS.Scheduling.StoryPoints"] = Number(
        get("story_points"),
      );
    if (get("effort"))
      fields["Microsoft.VSTS.Scheduling.Effort"] = Number(get("effort"));
    const facets = itemFacets(fields, CSV_PROCESS).map((facet) =>
      facet.domain === "state"
        ? { ...facet, value: stateFacetValue(CSV_PROCESS, state) }
        : facet,
    );
    const assignee = identity(get("assignee"));
    const creator = identity(get("createdBy"));
    if (get("assignee") && !assignee.email)
      losses.push({ code: "assignee_email_unavailable" });
    let description: string | undefined;
    const html = get("description");
    if (html) {
      const converted = htmlToText(html);
      if (converted.text) description = converted.text;
      if (converted.lossy)
        losses.push({ code: "rich_text_lossy", detailCode: "description" });
    }
    const project = get("project");
    const url = safeHttpsUrl(
      project
        ? `${baseUrl}/${encodeURIComponent(project)}/_workitems/edit/${id}`
        : undefined,
    );
    const created = isoDate(get("created"));
    const changed = isoDate(get("changed"));
    const start = isoDate(get("start"));
    const due = isoDate(get("due"));
    const parent = /^\d+$/u.test(get("parent")) ? get("parent") : undefined;
    const customFields = facets
      .filter((facet) => facet.domain === "custom_field")
      .map((facet) => ({
        key: facet.value,
        value:
          facet.value === "Severity"
            ? get("severity")
            : facet.value === "Story Points"
              ? Number(get("story_points"))
              : Number(get("effort")),
      }));
    records.push({
      sourceType: "work_item",
      sourceId: id,
      ...(url ? { sourceUrl: url } : {}),
      title: title.slice(0, 500),
      ...(description ? { description } : {}),
      ...(start ? { startDate: start } : {}),
      ...(due ? { dueDate: due } : {}),
      ...(created ? { sourceCreatedAt: created } : {}),
      ...(changed ? { sourceUpdatedAt: changed } : {}),
      ...(creator.email ? { sourceAuthorEmail: creator.email } : {}),
      ...(creator.name ? { sourceAuthorName: creator.name } : {}),
      ...(assignee.email ? { assigneeEmail: assignee.email } : {}),
      ...(parent ? { parentSourceId: parent } : {}),
      facets,
      ...(customFields.length ? { customFields } : {}),
      losses,
    });
  }
  return { records, skippedRows };
}
