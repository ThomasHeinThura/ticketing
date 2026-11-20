import { useMutation, useQueryClient } from "@tanstack/react-query";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { capturePreferencesHistoryRefresh } from "@/fetchers/settings/personal-history";
import {
  patchUserSettings,
  type UserSettingsPatch,
} from "@/fetchers/user-settings/user-settings";
import { authClient } from "@/lib/auth-client";
import { profileSessionGuard } from "@/lib/profile-session-guard";

/**
 * Writes some of the caller's settings. Deliberately silent on failure: the local cache is
 * already updated and the caller keeps a `dirty` marker so the value is pushed again on the
 * next successful load (settings-hierarchy.md ST-17).
 */
export function usePatchUserSettings() {
  const client = useQueryClient();
  const { user } = useAuth();
  const { data: session } = authClient.useSession();
  return useMutation({
    mutationFn: async (patch: UserSettingsPatch) => {
      const userId = session?.user?.id;
      const sessionId = session?.session?.id;
      const host = window.location.host;
      if (!userId || !sessionId || user?.id !== userId)
        throw new Error("Settings save cancelled: no session");
      const refresh = capturePreferencesHistoryRefresh(client, session);
      await profileSessionGuard(userId, sessionId)();
      if (window.location.host !== host)
        throw new Error("Settings save cancelled: host changed");
      const result = await patchUserSettings(patch);
      refresh();
      return result;
    },
  });
}
