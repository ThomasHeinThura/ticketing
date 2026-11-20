import { useMutation, useQueryClient } from "@tanstack/react-query";
import { refreshSettingsHistory } from "@/components/settings/refresh-settings-history";
import { profileHistoryKey } from "@/fetchers/settings/personal-history";
import uploadAvatar from "@/fetchers/user/upload-avatar";
import { authClient } from "@/lib/auth-client";
import { prepareAvatarImage } from "@/lib/prepare-avatar-image";
import { profileSessionGuard } from "@/lib/profile-session-guard";
import invalidateUserProfileQueries from "./invalidate-user-profile-queries";

function useUpdateUserAvatar() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  return useMutation({
    mutationFn: async (file: File) => {
      const check = profileSessionGuard(
        session?.user?.id,
        session?.session?.id,
      );
      const key = profileHistoryKey(
        session?.user?.id ?? "",
        session?.session?.id ?? "",
      );
      const { contentType, data } = await prepareAvatarImage(file);
      await check();
      const avatar = await uploadAvatar({ contentType, data });

      await check();
      const { error } = await authClient.updateUser({ image: avatar.url });

      if (error) {
        throw new Error(error.message || "Failed to update profile picture");
      }

      refreshSettingsHistory(queryClient, key, () => check(true));
      await check(true);
      return { avatar, check };
    },
    onSuccess: async ({ check }) => {
      await check(true);
      await invalidateUserProfileQueries(queryClient);
      await check(true);

      await check(true);
    },
  });
}

export default useUpdateUserAvatar;
