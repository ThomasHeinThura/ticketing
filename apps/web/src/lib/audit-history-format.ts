import { formatDate, formatDateTime } from "@/lib/format";

/**
 * AU-8/AU-9 display helpers: readable labels for the audit disclosure. The audit routes carry
 * raw action keys, field keys and ids; none of those is shown to a person as-is.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

const MAX_VALUE_LENGTH = 120;

/** A dotted or snake_case key as words, only for keys with no catalogue label. */
export function humanizeKey(key: string): string {
  const words = key.replace(/[._]+/g, " ").trim();
  return words.length === 0
    ? key
    : words.charAt(0).toUpperCase() + words.slice(1);
}

/** The audit row's action as a label; unknown keys fall back to readable words. */
export function auditActionLabel(action: string, t: Translate): string {
  return t(
    `workItemExtras:auditHistory.actions.${action.replace(/\./g, "_")}`,
    {
      defaultValue: humanizeKey(action),
    },
  );
}

/** A recorded field key as a label; unknown keys fall back to readable words. */
export function auditFieldLabel(field: string, t: Translate): string {
  return t(`workItemExtras:auditHistory.fields.${field}`, {
    defaultValue: humanizeKey(field),
  });
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_VALUE_LENGTH
    ? `${flat.slice(0, MAX_VALUE_LENGTH - 1)}…`
    : flat;
}

function collectText(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (typeof record.text === "string") out.push(record.text);
  if (Array.isArray(record.content)) {
    for (const child of record.content) collectText(child, out);
  }
}

/** Plain text of a stored rich-text (tiptap) document, or null when it is not one. */
export function richTextToPlain(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).type === "doc"
    ) {
      const out: string[] = [];
      collectText(parsed, out);
      return out.join(" ");
    }
  } catch {
    return null;
  }
  return null;
}

/** Calendar dates: stored as midnight UTC, so shown in UTC or they slip a day west of Greenwich. */
const DATE_ONLY_FIELDS = new Set([
  "due_date",
  "dueDate",
  "start_date",
  "startDate",
]);
/** Instants: shown in the reader's own time zone. */
const INSTANT_FIELDS = new Set(["archived_at", "deleted_at"]);

/**
 * A recorded date field as a localized date (calendar dates) or date and time (instants), in
 * the active language; null for any other field or a value that is not a date.
 */
export function recordedDateLabel(
  field: string,
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const dateOnly = DATE_ONLY_FIELDS.has(field);
  if (!dateOnly && !INSTANT_FIELDS.has(field)) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return dateOnly
    ? formatDate(time, { dateStyle: "medium", timeZone: "UTC" })
    : formatDateTime(time);
}

export type AuditValueLookups = {
  states: ReadonlyMap<string, string>;
  people: ReadonlyMap<string, string>;
  /** Shown when an id (state, person, project, parent) cannot be resolved to a name. */
  unknown: string;
  /** Shown for a rich-text field with no readable text. */
  empty: string;
  none: string;
  /** Shown for an assignee field recorded as empty. */
  unassigned?: string;
  priority: (value: string) => string;
};

/**
 * One recorded value as text: state and person ids become names, priority its label, rich
 * text its first words, and any other JSON a short plain rendering. Never a raw id.
 */
export function auditValueLabel(
  field: string,
  value: string | null,
  lookups: AuditValueLookups,
): string {
  if (value === null || value === "")
    return (field === "assigneeId" || field === "assignee") &&
      lookups.unassigned
      ? lookups.unassigned
      : lookups.none;
  if (field === "stateId") return lookups.states.get(value) ?? lookups.unknown;
  if (field === "assigneeId" || field === "assignee" || field === "requester")
    return lookups.people.get(value) ?? lookups.unknown;
  if (field === "priority") return lookups.priority(value);
  if (field === "description") {
    const plain = richTextToPlain(value) ?? value;
    return plain.trim() ? truncate(plain) : lookups.empty;
  }
  const date = recordedDateLabel(field, value);
  if (date) return date;
  if (field === "project" || field === "parent" || field === "template")
    return lookups.unknown;
  return truncate(value);
}

function recordedStateId(side: unknown): string | null {
  if (!side || typeof side !== "object") return null;
  const id = (side as Record<string, unknown>).stateId;
  return typeof id === "string" && id !== "" ? id : null;
}

/** "Old -> New" state names for an audit row that recorded a state change, else null. */
export function auditStateChange(
  before: unknown,
  after: unknown,
  lookups: AuditValueLookups,
): string | null {
  const from = recordedStateId(before);
  const to = recordedStateId(after);
  if (!from && !to) return null;
  const name = (id: string | null) =>
    id ? (lookups.states.get(id) ?? lookups.unknown) : lookups.none;
  return `${name(from)} \u2192 ${name(to)}`;
}
