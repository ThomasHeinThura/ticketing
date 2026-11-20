import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  profileHistoryKey,
  refreshPersonalHistory,
} from "@/fetchers/settings/personal-history";
import { authClient } from "@/lib/auth-client";
import { profileSessionGuard } from "@/lib/profile-session-guard";
import invalidateUserProfileQueries from "./invalidate-user-profile-queries";

type UpdateUserProfileRequest = {
  name?: string;
  locale?: string;
};

function useUpdateUserProfile() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  return useMutation({
    mutationFn: async ({ name, locale }: UpdateUserProfileRequest) => {
      const check = profileSessionGuard(
        session?.user?.id,
        session?.session?.id,
      );
      const key = profileHistoryKey(
        session?.user?.id ?? "",
        session?.session?.id ?? "",
      );
      await check();
      const { data, error } = await authClient.updateUser({
        name,
        locale,
      });

      if (error) {
        throw new Error(error.message || "Failed to update user profile");
      }

      refreshPersonalHistory(queryClient, key);
      await check(true);
      return { data, check };
    },
    onSuccess: async ({ check }) => {
      await check(true);
      await invalidateUserProfileQueries(queryClient);
      await check(true);
    },
  });
}

export default useUpdateUserProfile;
