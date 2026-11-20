import { authClient } from "@/lib/auth-client";
import { HttpError } from "@/lib/http-error";

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
    const message = saved
      ? "Profile saved; session changed before refresh"
      : "Profile save cancelled: session changed";
    // A refused check keeps its status; a confirmed different identity is a 403 (hidden, no redirect).
    if (error) throw new HttpError(error.status ?? 503, message);
    if (data?.user?.id !== userId || data.session?.id !== sessionId)
      throw new HttpError(403, message);
  };
}
