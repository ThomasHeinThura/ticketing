import { useMutation } from "@tanstack/react-query";
import {
  patchUserSettings,
  type UserSettingsPatch,
} from "@/fetchers/user-settings/user-settings";

/**
 * Writes some of the caller's settings. Deliberately silent on failure: the local cache is
 * already updated and the caller keeps a `dirty` marker so the value is pushed again on the
 * next successful load (settings-hierarchy.md ST-17).
 */
export function usePatchUserSettings() {
  return useMutation({
    mutationFn: (patch: UserSettingsPatch) => patchUserSettings(patch),
  });
}
