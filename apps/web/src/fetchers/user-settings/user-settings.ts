import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Self-scoped profile settings (settings-hierarchy.md "Profile settings routes", ST-12..ST-17).
const settings = client.me.settings;

export type UserSettings = InferResponseType<typeof settings.$get, 200>;

/** A partial object of whitelisted keys; `null` clears a key. */
export type UserSettingsPatch = Record<string, unknown>;

/**
 * The settings read is a best-effort background sync, so a 401 must never reach the query
 * cache as an `HttpError(401)`: that triggers the global hard redirect to sign-in. A 401 here
 * can be transient. Verifying the first authenticator factor deletes the old session and sets a
 * new cookie, so a read already in flight with the old cookie is rejected while the user is
 * still signed in; the redirect then tears down the enrolment page before its one-time backup
 * codes are shown. A genuinely expired session is still redirected by the auth session query
 * and by every foreground read.
 */
export class SettingsSyncUnauthorizedError extends Error {
  constructor() {
    super("Settings sync skipped: session not valid");
    this.name = "SettingsSyncUnauthorizedError";
  }
}

export async function getUserSettings(): Promise<UserSettings> {
  const response = await settings.$get();
  // The typed client narrows `status` to the documented 200; widen it to see a 401.
  const status: number = response.status;
  if (status === 401) throw new SettingsSyncUnauthorizedError();
  if (!response.ok) {
    throw new HttpError(response.status, "Unable to load settings");
  }
  return parseUserSettings(await response.json());
}

/**
 * Only a `{ settings: {…} }` object is accepted. Anything else (an empty array from a stub, a
 * proxy's HTML, a null) is a failed read, so the query errors and the local cache keeps
 * serving instead of the sync reading a property of undefined.
 */
function parseUserSettings(body: unknown): UserSettings {
  const settings =
    typeof body === "object" && body !== null
      ? (body as { settings?: unknown }).settings
      : undefined;
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    throw new HttpError(502, "Unexpected settings response");
  }
  return { settings: settings as UserSettings["settings"] };
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
