import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Self-scoped `user_preference` routes (views.md "Preference routes", PREF-1..8).
const preferences = client.me.preferences;

export type UserPreferenceScope = "global" | "workspace" | "project";

export type UserPreferenceList = InferResponseType<
  typeof preferences.$get,
  200
>;

export async function getUserPreferences(input: {
  scope: UserPreferenceScope;
  scopeId?: string;
}): Promise<UserPreferenceList> {
  const response = await preferences.$get({
    query: {
      scope: input.scope,
      ...(input.scopeId ? { scopeId: input.scopeId } : {}),
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Unable to load preferences");
  }
  return (await response.json()) as UserPreferenceList;
}

export async function putUserPreference(input: {
  scope: UserPreferenceScope;
  key: string;
  scopeId?: string;
  value: unknown;
}) {
  const response = await preferences[":scope"][":key"].$put({
    param: { scope: input.scope, key: input.key },
    json: {
      ...(input.scopeId ? { scopeId: input.scopeId } : {}),
      value: input.value,
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Unable to save preference");
  }
  return response.json();
}
