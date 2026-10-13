import { useUserPreferencesEffects } from "@/hooks/use-user-preferences-effects";

/**
 * Applies document-level user preferences (currently `html.compact-mode`).
 * Mounted once at the agent app root so every `/agent/**` and `/dashboard/**`
 * route respects the density preference. Do not mount it in a layout.
 */
export function UserPreferencesEffects() {
  useUserPreferencesEffects();
  return null;
}
