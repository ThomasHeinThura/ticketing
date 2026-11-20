import { useMutation, useQueryClient } from "@tanstack/react-query";
import { capturePersonalSelfHistoryRefresh } from "@/fetchers/settings/personal-history";
import { authClient } from "@/lib/auth-client";

type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
};

function useChangePassword() {
  const client = useQueryClient();
  const { data: session } = authClient.useSession();
  return useMutation({
    mutationFn: async ({
      currentPassword,
      newPassword,
      revokeOtherSessions,
    }: ChangePasswordRequest) => {
      const refreshHistory = capturePersonalSelfHistoryRefresh(
        client,
        "security",
        "staff",
        session,
      );
      const { data, error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });

      if (error) {
        throw new Error(error.code || "UNKNOWN");
      }

      refreshHistory();
      return data;
    },
  });
}

export default useChangePassword;
