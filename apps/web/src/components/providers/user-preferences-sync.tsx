import { useDensityPreferenceSync } from "@/hooks/use-density-preference";

/**
 * Reconciles browser-cached per-user preferences with the server (`user_preference`).
 * Mounted once inside the auth provider so it only fetches for a signed-in user.
 */
export function UserPreferencesSync() {
  useDensityPreferenceSync();
  return null;
}
