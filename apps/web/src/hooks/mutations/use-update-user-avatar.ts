import { useMutation, useQueryClient } from "@tanstack/react-query";
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
      const { contentType, data } = await prepareAvatarImage(file);
      await check();
      const avatar = await uploadAvatar({ contentType, data });

      await check();
      const { error } = await authClient.updateUser({ image: avatar.url });

      if (error) {
        throw new Error(error.message || "Failed to update profile picture");
      }

      return { avatar, check };
    },
    onSuccess: async ({ check }) => {
      await check(true);
      await invalidateUserProfileQueries(queryClient);
      await check(true);
    },
    meta: {
      audits: {
        targets: () => [
          { kind: "self", audience: "staff", section: "profile" },
        ],
      },
    },
  });
}

export default useUpdateUserAvatar;
