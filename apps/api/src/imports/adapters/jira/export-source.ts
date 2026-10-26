/**
 * Mode (a): a Jira JSON export supplied in the connection config (size-limited) or a stored file.
 *
 * Accepted shapes: `{ issues: [...] }` (the REST/search JSON), a bare array of issues, or
 * `{ projects: [{ issues: [...] }] }`. A `names` map (field id -> name) is used when present.
 * The parse is deterministic: rows are de-duplicated by key (the most recently updated row wins,
 * ties keep the later row) and ordered parents-first, then by file order, so the same export
 * always pages identically.
 */
import { asArray, asObject, asString, type Raw } from "./normalize";

export const MAX_INLINE_EXPORT_BYTES = 8_000_000;
export const MAX_EXPORT_ISSUES = 50_000;

export class JiraSourceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "JiraSourceError";
  }
}

export type ParsedExport = {
  issues: Raw[];
  names: Map<string, string>;
  /** Keys that appeared more than once in the file. */
  collapsed: Set<string>;
};

function collectIssues(root: unknown): { rows: unknown[]; names: Raw } {
  if (Array.isArray(root)) return { rows: root, names: {} };
  const object = asObject(root);
  if (!object) throw new JiraSourceError("jira_export_invalid");
  const names = asObject(object.names) ?? {};
  if (Array.isArray(object.issues)) return { rows: object.issues, names };
  if (Array.isArray(object.projects)) {
    const rows = object.projects.flatMap((project) =>
      asArray(asObject(project)?.issues),
    );
    return { rows, names };
  }
  throw new JiraSourceError("jira_export_invalid");
}

export function parseExport(root: unknown): ParsedExport {
  const { rows, names: rawNames } = collectIssues(root);
  if (rows.length > MAX_EXPORT_ISSUES)
    throw new JiraSourceError("jira_export_too_large");
  const names = new Map<string, string>();
  for (const [id, name] of Object.entries(rawNames)) {
    const text = asString(name);
    if (text) names.set(id, text);
  }
  const byKey = new Map<string, Raw>();
  const order: string[] = [];
  const collapsed = new Set<string>();
  for (const row of rows) {
    const issue = asObject(row);
    const key = asString(issue?.key);
    if (!issue || !key || !asObject(issue.fields))
      throw new JiraSourceError("jira_export_invalid");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, issue);
      order.push(key);
      continue;
    }
    collapsed.add(key);
    const updated = (value: Raw) =>
      Date.parse(asString(asObject(value.fields)?.updated) ?? "") || 0;
    if (updated(issue) >= updated(existing)) byKey.set(key, issue);
  }
  // Parents first: depth by `parent`, so a child never precedes its parent in the stream.
  const parentOf = (key: string) =>
    asString(asObject(asObject(byKey.get(key)?.fields)?.parent)?.key);
  const depth = (key: string): number => {
    let level = 0;
    let current = parentOf(key);
    const seen = new Set<string>([key]);
    while (current && byKey.has(current) && !seen.has(current)) {
      seen.add(current);
      level += 1;
      current = parentOf(current);
    }
    return level;
  };
  const indexed = order.map((key, index) => ({
    key,
    index,
    level: depth(key),
  }));
  indexed.sort((a, b) => a.level - b.level || a.index - b.index);
  const issues = indexed.flatMap(({ key }) => {
    const issue = byKey.get(key);
    return issue ? [issue] : [];
  });
  return { issues, names, collapsed };
}
