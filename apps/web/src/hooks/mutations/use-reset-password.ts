import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { portalAuthClient } from "@/lib/portal-auth-client";

export default function useResetPassword() {
  const pending = useRef<{ token: string; newPassword: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!pending.current) throw new Error("No password reset pending");
      const { token, newPassword } = pending.current;
      const { data, error } = await portalAuthClient.$fetch("/reset-password", {
        method: "POST",
        body: { token, newPassword },
      });
      if (error) throw new Error(error.message || "Password reset failed");
      return data;
    },
  });
  return {
    ...mutation,
    mutateAsync: async (input: { token: string; newPassword: string }) => {
      if (pending.current) throw new Error("Password reset already pending");
      pending.current = input;
      try {
        return await mutation.mutateAsync();
      } finally {
        pending.current = null;
      }
    },
  };
}
