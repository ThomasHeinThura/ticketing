import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  profileHistoryKey,
  refreshPersonalHistory,
} from "@/fetchers/settings/personal-history";
import deleteAvatar from "@/fetchers/user/delete-avatar";
import { authClient } from "@/lib/auth-client";
import { profileSessionGuard } from "@/lib/profile-session-guard";
import invalidateUserProfileQueries from "./invalidate-user-profile-queries";

function useRemoveUserAvatar() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  return useMutation({
    mutationFn: async () => {
      const check = profileSessionGuard(
        session?.user?.id,
        session?.session?.id,
      );
      const key = profileHistoryKey(
        session?.user?.id ?? "",
        session?.session?.id ?? "",
      );
      await check();
      const { error } = await authClient.updateUser({ image: null });

      if (error) {
        throw new Error(error.message || "Failed to remove profile picture");
      }

      refreshPersonalHistory(queryClient, key);
      await check(true);
      const result = await deleteAvatar();
      await check(true);
      return result;
    },
    onSuccess: () => invalidateUserProfileQueries(queryClient),
  });
}

export default useRemoveUserAvatar;
