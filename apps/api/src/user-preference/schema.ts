import { z } from "../openapi";
import {
  PREFERENCE_KEY_MAX_LENGTH,
  PREFERENCE_SCOPE_ID_MAX_LENGTH,
} from "./whitelist";

// Semantic validation (scope vocabulary, key whitelist, value schema, scope/scopeId shape)
// is done in the service and answered `422` per views.md PREF-5. These schemas only reject
// a structurally malformed request (`400`), so an unknown key is not a schema failure.
export const listPreferencesQuery = z.object({
  scope: z.string().max(32),
  scopeId: z.string().max(PREFERENCE_SCOPE_ID_MAX_LENGTH).optional(),
});

export const preferencePathParams = z.object({
  scope: z.string().max(32),
  key: z.string().max(PREFERENCE_KEY_MAX_LENGTH),
});

export const putPreferenceBody = z.object({
  scopeId: z.string().max(PREFERENCE_SCOPE_ID_MAX_LENGTH).optional().openapi({
    description:
      "Required for `workspace` and `project` scope, forbidden for `global`.",
  }),
  value: z.unknown().optional().openapi({
    description:
      "The key's value; its schema is fixed per key (views.md PREF-5).",
  }),
});
