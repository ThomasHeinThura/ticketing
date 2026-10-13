import { z } from "../openapi";

/**
 * Closed whitelist of `user_preference` keys writable and readable through
 * `/api/me/preferences` (views.md `PREF-5`). Adding a key is a spec change in
 * `docs/03-features/views.md` and a change here, never a runtime option.
 */
export const PREFERENCE_SCOPES = ["global", "workspace", "project"] as const;
export type PreferenceScope = (typeof PREFERENCE_SCOPES)[number];

export function isPreferenceScope(value: string): value is PreferenceScope {
  return (PREFERENCE_SCOPES as readonly string[]).includes(value);
}

type PreferenceDefinition = {
  readonly scope: PreferenceScope;
  readonly value: z.ZodType;
};

export const PREFERENCE_DEFINITIONS = {
  "project.layout": {
    scope: "project",
    value: z.enum(["board", "list"]),
  },
  "appearance.density": {
    scope: "global",
    value: z.enum(["comfortable", "compact"]),
  },
} as const satisfies Record<string, PreferenceDefinition>;

export type PreferenceKey = keyof typeof PREFERENCE_DEFINITIONS;

export const PREFERENCE_KEYS = Object.keys(
  PREFERENCE_DEFINITIONS,
) as PreferenceKey[];

export function isPreferenceKey(value: string): value is PreferenceKey {
  return Object.hasOwn(PREFERENCE_DEFINITIONS, value);
}

export function keysForScope(scope: PreferenceScope): PreferenceKey[] {
  return PREFERENCE_KEYS.filter(
    (key) => PREFERENCE_DEFINITIONS[key].scope === scope,
  );
}

/** Size limits, views.md `PREF-7`. */
export const PREFERENCE_BODY_MAX_BYTES = 4096;
export const PREFERENCE_KEY_MAX_LENGTH = 64;
export const PREFERENCE_SCOPE_ID_MAX_LENGTH = 128;
export const PREFERENCE_MAX_ROWS_PER_PERSON = 500;
