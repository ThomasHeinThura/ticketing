import { authClient } from "@/lib/auth-client";

export function profileSessionGuard(userId?: string, sessionId?: string) {
  if (!userId || !sessionId)
    throw new Error("Profile save cancelled: session unavailable");
  return async (saved = false) => {
    const { data, error } = await authClient
      .getSession({ query: { disableCookieCache: true } })
      .catch(() => {
        throw new Error(
          saved
            ? "Profile saved; session could not be checked before refresh"
            : "Profile save cancelled: session could not be checked",
        );
      });
    if (error || data?.user?.id !== userId || data.session?.id !== sessionId)
      throw new Error(
        saved
          ? "Profile saved; session changed before refresh"
          : "Profile save cancelled: session changed",
      );
  };
}
