/**
 * Placeholder expansion that respects the destination's visibility (`AM-11`).
 *
 * A placeholder is `{{path}}`. Every known path is classified `public` (safe in anything a
 * customer can read) or `staff` (an assignee's email, an internal SLA breach note, an
 * internal-only custom field, an internal note). Writing a `staff` placeholder into a
 * customer-visible destination is refused at save time with the offending placeholder named, and
 * the same classification is applied again at execution, where a value that has become staff-only
 * since the rule was saved is **redacted**, never leaked. An unknown path is refused: a typo must
 * not silently render as empty text, and an arbitrary path must never reach a value the
 * classification has not seen.
 */

export type PlaceholderVisibility = "public" | "staff";
export type DestinationAudience = "customer" | "staff";

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_.-]{1,64})\s*\}\}/g;

/** The closed vocabulary. `cf.<key>` is never listed: custom fields have no loader yet. */
export const PLACEHOLDER_VISIBILITY: Readonly<
  Record<string, PlaceholderVisibility>
> = {
  "work_item.key": "public",
  "work_item.title": "public",
  "work_item.url": "public",
  "work_item.state": "public",
  "work_item.priority": "public",
  "project.key": "public",
  "project.name": "public",
  "actor.name": "public",
  "assignee.name": "public",
  "assignee.email": "staff",
  "requester.name": "public",
  "requester.email": "staff",
  "sla.breach_note": "staff",
  "work_item.internal_note": "staff",
};

export type PlaceholderRef = {
  path: string;
  visibility: PlaceholderVisibility | "unknown";
};

export function extractPlaceholders(template: string): PlaceholderRef[] {
  const seen = new Map<string, PlaceholderRef>();
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const path = match[1] as string;
    if (!seen.has(path))
      seen.set(path, {
        path,
        visibility: Object.hasOwn(PLACEHOLDER_VISIBILITY, path)
          ? (PLACEHOLDER_VISIBILITY[path] as PlaceholderVisibility)
          : "unknown",
      });
  }
  return [...seen.values()];
}

export type PlaceholderProblem = { path: string; reason: string };

/**
 * Save-time check: every placeholder is known, and none is staff-only when the destination is
 * customer-visible. Returns the full list (for the dry-run validation panel) plus the problems.
 */
export function validatePlaceholders(
  template: string,
  audience: DestinationAudience,
): { placeholders: PlaceholderRef[]; problems: PlaceholderProblem[] } {
  const placeholders = extractPlaceholders(template);
  const problems: PlaceholderProblem[] = [];
  for (const ref of placeholders) {
    if (ref.visibility === "unknown")
      problems.push({ path: ref.path, reason: "unknown placeholder" });
    else if (ref.visibility === "staff" && audience === "customer")
      problems.push({
        path: ref.path,
        reason: "staff-only value in a customer-visible destination",
      });
  }
  return { placeholders, problems };
}

export const REDACTED = "[redacted]";

/**
 * Execution-time expansion. `values` holds only what the caller loaded; a missing value renders
 * empty. A staff-only path into a customer destination is replaced by `REDACTED` even if the
 * value is present, covering a classification that changed after save.
 */
export function expandPlaceholders(
  template: string,
  values: Readonly<Record<string, string | null | undefined>>,
  audience: DestinationAudience,
): string {
  return template.replace(PLACEHOLDER_PATTERN, (_whole, rawPath: string) => {
    const path = rawPath.trim();
    if (!Object.hasOwn(PLACEHOLDER_VISIBILITY, path)) return REDACTED;
    if (PLACEHOLDER_VISIBILITY[path] === "staff" && audience === "customer")
      return REDACTED;
    return values[path] ?? "";
  });
}
