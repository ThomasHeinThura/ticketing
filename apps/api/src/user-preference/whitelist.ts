import { z } from "../openapi";

/**
 * Closed whitelist of `GET/PATCH /api/me/settings` keys (settings-hierarchy.md `ST-12`..`ST-17`).
 * Each key names one `user_preference` row:
 *
 * | settings key         | scope     | scope_id   | key       | value                          |
 * | -------------------- | --------- | ---------- | --------- | ------------------------------ |
 * | `density`            | `global`  | null       | `density` | `comfortable` or `compact`     |
 * | `layout.<projectId>` | `project` | project id | `layout`  | `board` or `list`              |
 *
 * `theme` and `sidebar` are named by the spec but have no specified value domain, so they are
 * not whitelisted. Adding a key is a spec change first, then a change here.
 */
export const DENSITY_SCHEMA = z.enum(["comfortable", "compact"]);
export const LAYOUT_SCHEMA = z.enum(["board", "list"]);

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
    };

const LAYOUT_PREFIX = "layout.";

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
    if (
      projectId.length === 0 ||
      projectId.length > SETTING_SCOPE_ID_MAX_LENGTH
    )
      return undefined;
    return {
      kind: "layout",
      scope: "project",
      scopeId: projectId,
      rowKey: "layout",
      schema: LAYOUT_SCHEMA,
    };
  }
  return undefined;
}

export function layoutSettingKey(projectId: string) {
  return `${LAYOUT_PREFIX}${projectId}`;
}

/** Size limits, settings-hierarchy.md `ST-16`. */
export const SETTINGS_BODY_MAX_BYTES = 4096;
export const SETTING_SCOPE_ID_MAX_LENGTH = 128;
export const SETTINGS_MAX_KEYS_PER_REQUEST = 20;
export const SETTINGS_MAX_ROWS_PER_PERSON = 500;
