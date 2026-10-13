import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Self-scoped profile settings (settings-hierarchy.md "Profile settings routes", ST-12..ST-17).
const settings = client.me.settings;

export type UserSettings = InferResponseType<typeof settings.$get, 200>;

/** A partial object of whitelisted keys; `null` clears a key. */
export type UserSettingsPatch = Record<string, unknown>;

export async function getUserSettings(): Promise<UserSettings> {
  const response = await settings.$get();
  if (!response.ok) {
    throw new HttpError(response.status, "Unable to load settings");
  }
  return (await response.json()) as UserSettings;
}

export async function patchUserSettings(
  patch: UserSettingsPatch,
): Promise<UserSettings> {
  const response = await settings.$patch({ json: patch });
  if (!response.ok) {
    throw new HttpError(response.status, "Unable to save settings");
  }
  return (await response.json()) as UserSettings;
}
