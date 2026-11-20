import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { authClient } from "@/lib/auth-client";

type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
};

function useChangePassword() {
  const pending = useRef<ChangePasswordRequest | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!pending.current) throw new Error("No password change pending");
      const { currentPassword, newPassword, revokeOtherSessions } =
        pending.current;
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });

      if (error) {
        throw new Error(error.code || "UNKNOWN");
      }
    },
    meta: {
      audits: {
        targets: () => [
          { kind: "self", audience: "staff", section: "security" },
        ],
      },
    },
  });
  return {
    ...mutation,
    mutateAsync: async (input: ChangePasswordRequest) => {
      if (pending.current) throw new Error("Password change already pending");
      pending.current = input;
      try {
        return await mutation.mutateAsync();
      } finally {
        pending.current = null;
      }
    },
  };
}

export default useChangePassword;
