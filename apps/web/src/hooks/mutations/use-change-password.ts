import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
};

function useChangePassword() {
  return useMutation({
    mutationFn: async ({
      currentPassword,
      newPassword,
      revokeOtherSessions,
    }: ChangePasswordRequest) => {
      const { data, error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });

      if (error) {
        throw new Error(error.code || "UNKNOWN");
      }

      return data;
    },
  });
}

export default useChangePassword;
