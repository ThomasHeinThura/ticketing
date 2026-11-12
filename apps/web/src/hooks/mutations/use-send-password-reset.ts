import { useMutation } from "@tanstack/react-query";
import { portalAuthClient } from "@/lib/portal-auth-client";

export default function useSendPasswordReset() {
  return useMutation({
    mutationFn: async ({
      email,
      redirectTo,
    }: {
      email: string;
      redirectTo: string;
    }) => {
      const { data, error } = await portalAuthClient.$fetch(
        "/request-password-reset",
        {
          method: "POST",
          body: { email, redirectTo },
        },
      );
      if (error)
        throw new Error(error.message || "Password reset request failed");
      return data;
    },
  });
}
