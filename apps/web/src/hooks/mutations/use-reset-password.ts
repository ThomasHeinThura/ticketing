import { useMutation } from "@tanstack/react-query";
import { portalAuthClient } from "@/lib/portal-auth-client";

export default function useResetPassword() {
  return useMutation({
    mutationFn: async ({
      token,
      newPassword,
    }: {
      token: string;
      newPassword: string;
    }) => {
      const { data, error } = await portalAuthClient.$fetch("/reset-password", {
        method: "POST",
        body: { token, newPassword },
      });
      if (error) throw new Error(error.message || "Password reset failed");
      return data;
    },
  });
}
