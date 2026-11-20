import { useMutation, useQueryClient } from "@tanstack/react-query";
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
      await check();
      const { error } = await authClient.updateUser({ image: null });

      if (error) {
        throw new Error(error.message || "Failed to remove profile picture");
      }

      return { check };
    },
    meta: {
      audits: {
        targets: () => [
          { kind: "self", audience: "staff", section: "profile" },
        ],
      },
    },
    // The profile write is committed (and audited) above; the file delete must not run for another session.
    onSuccess: async ({ check }) => {
      await check(true);
      const result = await deleteAvatar();
      await check(true);
      await invalidateUserProfileQueries(queryClient);
      return result;
    },
  });
}

export default useRemoveUserAvatar;
