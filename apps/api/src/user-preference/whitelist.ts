import { z } from "../openapi";

/**
 * Closed whitelist of `GET/PATCH /api/me/settings` keys (settings-hierarchy.md `ST-12`..`ST-17`).
 * Each key names one `user_preference` row:
 *
 * | settings key         | scope     | scope_id   | key       | value                          |
 * | -------------------- | --------- | ---------- | --------- | ------------------------------ |
 * | `density`            | `global`  | null       | `density` | `comfortable` or `compact`     |
 * | `layout.<projectId>` | `project` | project id | `layout`  | `board`, `list` or `table`     |
 *
 * | `listGroups.<projectId>` | `project` | project id | `listGroups` | collapsed list group (state) ids, at most 50 (`VW-15`) |
 * | `columns.<projectId>`    | `project` | project id | `columns`    | the table's chosen columns in display order (`VW-19`) |
 * | `columnWidths.<projectId>` | `project` | project id | `columnWidths` | registered column IDs to 64–800 px integer widths, at most 100 entries (`VW-21`, Thomas approved 25 Oct) |
 *
 * `theme` and `sidebar` are named by the spec but have no specified value domain, so they are
 * not whitelisted. Adding a key is a spec change first, then a change here.
 */
export const DENSITY_SCHEMA = z.enum(["comfortable", "compact"]);
export const LAYOUT_SCHEMA = z.enum(["board", "list", "table"]);

/** State ids are cuid2-shaped; the bound keeps one row far below the 4 KiB body limit. */
const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const LIST_GROUPS_MAX = 50;
/** `VW-15`: the list groups the person collapsed. A set, so duplicates are refused. */
export const LIST_GROUPS_SCHEMA = z
  .array(z.string().regex(GROUP_ID_PATTERN))
  .max(LIST_GROUPS_MAX)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "list groups must not repeat",
  });

/** Native table columns; live `cf.<key>` columns are checked in the settings service. */
export const TABLE_COLUMNS = [
  "key",
  "title",
  "state",
  "assignee",
  "priority",
  "dueDate",
] as const;
export const CUSTOM_FIELD_COLUMN_PATTERN = /^cf\.[a-z][a-z0-9_]{0,63}$/u;
const TABLE_COLUMN_SET: ReadonlySet<string> = new Set(TABLE_COLUMNS);
const TABLE_COLUMN_ID_SCHEMA = z
  .string()
  .refine(
    (column) =>
      TABLE_COLUMN_SET.has(column) || CUSTOM_FIELD_COLUMN_PATTERN.test(column),
    { message: "unknown table column" },
  );
/** `VW-19`: a non-empty, duplicate-free subset of the columns, in display order. */
export const COLUMNS_SCHEMA = z
  .array(TABLE_COLUMN_ID_SCHEMA)
  .min(1)
  .max(100)
  .refine((columns) => new Set(columns).size === columns.length, {
    message: "columns must not repeat",
  });

/** VW-21 widths; syntax is checked here and live custom-field registration in the service. */
export const COLUMN_WIDTHS_SCHEMA = z
  .record(TABLE_COLUMN_ID_SCHEMA, z.number().int().min(64).max(800))
  .refine((widths) => Object.keys(widths).length <= 100, {
    message: "at most 100 column widths are allowed",
  });

export type SettingTarget =
  | {
      readonly kind: "density";
      readonly scope: "global";
      readonly scopeId: null;
      readonly rowKey: "density";
      readonly schema: typeof DENSITY_SCHEMA;
    }
  | {
      readonly kind: "layout";
      readonly scope: "project";
      readonly scopeId: string;
      readonly rowKey: "layout";
      readonly schema: typeof LAYOUT_SCHEMA;
    }
  | {
      readonly kind: "listGroups";
      readonly scope: "project";
      readonly scopeId: string;
      readonly rowKey: "listGroups";
      readonly schema: typeof LIST_GROUPS_SCHEMA;
    }
  | {
      readonly kind: "columns";
      readonly scope: "project";
      readonly scopeId: string;
      readonly rowKey: "columns";
      readonly schema: typeof COLUMNS_SCHEMA;
    }
  | {
      readonly kind: "columnWidths";
      readonly scope: "project";
      readonly scopeId: string;
      readonly rowKey: "columnWidths";
      readonly schema: typeof COLUMN_WIDTHS_SCHEMA;
    };

export const SETTING_SCOPE_ID_MAX_LENGTH = 128;

/**
 * Project ids are cuid2 (lowercase alphanumerics). The pattern is a little wider (letters,
 * digits, `_`, `-`, at most `SETTING_SCOPE_ID_MAX_LENGTH`) so every id the repository has
 * produced matches, while NUL, other control characters and non-ASCII never reach a query
 * (Postgres rejects NUL in text, which used to surface as a 500).
 */
const PROJECT_ID_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{1,${SETTING_SCOPE_ID_MAX_LENGTH}}$`,
);

const LAYOUT_PREFIX = "layout.";
const LIST_GROUPS_PREFIX = "listGroups.";
const COLUMNS_PREFIX = "columns.";
const COLUMN_WIDTHS_PREFIX = "columnWidths.";

/** The `user_preference.key` values a project-scoped settings key can occupy. */
export const PROJECT_ROW_KEYS = [
  "layout",
  "listGroups",
  "columns",
  "columnWidths",
] as const;

/** Returns the row a settings key addresses, or undefined for a key that is not whitelisted. */
export function parseSettingKey(key: string): SettingTarget | undefined {
  if (key === "density") {
    return {
      kind: "density",
      scope: "global",
      scopeId: null,
      rowKey: "density",
      schema: DENSITY_SCHEMA,
    };
  }
  if (key.startsWith(LAYOUT_PREFIX)) {
    const projectId = key.slice(LAYOUT_PREFIX.length);
    if (!PROJECT_ID_PATTERN.test(projectId)) return undefined;
    return {
      kind: "layout",
      scope: "project",
      scopeId: projectId,
      rowKey: "layout",
      schema: LAYOUT_SCHEMA,
    };
  }
  if (key.startsWith(LIST_GROUPS_PREFIX)) {
    const projectId = key.slice(LIST_GROUPS_PREFIX.length);
    if (!PROJECT_ID_PATTERN.test(projectId)) return undefined;
    return {
      kind: "listGroups",
      scope: "project",
      scopeId: projectId,
      rowKey: "listGroups",
      schema: LIST_GROUPS_SCHEMA,
    };
  }
  if (key.startsWith(COLUMNS_PREFIX)) {
    const projectId = key.slice(COLUMNS_PREFIX.length);
    if (!PROJECT_ID_PATTERN.test(projectId)) return undefined;
    return {
      kind: "columns",
      scope: "project",
      scopeId: projectId,
      rowKey: "columns",
      schema: COLUMNS_SCHEMA,
    };
  }
  if (key.startsWith(COLUMN_WIDTHS_PREFIX)) {
    const projectId = key.slice(COLUMN_WIDTHS_PREFIX.length);
    if (!PROJECT_ID_PATTERN.test(projectId)) return undefined;
    return {
      kind: "columnWidths",
      scope: "project",
      scopeId: projectId,
      rowKey: "columnWidths",
      schema: COLUMN_WIDTHS_SCHEMA,
    };
  }
  return undefined;
}

export function layoutSettingKey(projectId: string) {
  return `${LAYOUT_PREFIX}${projectId}`;
}

/** The settings key a stored project row is served under, or undefined for any other row. */
export function projectSettingKey(
  rowKey: string,
  projectId: string,
): string | undefined {
  switch (rowKey) {
    case "layout":
      return layoutSettingKey(projectId);
    case "listGroups":
      return `${LIST_GROUPS_PREFIX}${projectId}`;
    case "columns":
      return `${COLUMNS_PREFIX}${projectId}`;
    case "columnWidths":
      return `${COLUMN_WIDTHS_PREFIX}${projectId}`;
    default:
      return undefined;
  }
}

/** Size limits, settings-hierarchy.md `ST-16`. */
export const SETTINGS_BODY_MAX_BYTES = 4096;
export const SETTINGS_MAX_KEYS_PER_REQUEST = 20;
export const SETTINGS_MAX_ROWS_PER_PERSON = 500;
/** Advisory-lock namespace serialising one person's settings writes (cap + upsert, ST-16). */
export const SETTINGS_WRITE_LOCK_NAMESPACE = 699_001;
