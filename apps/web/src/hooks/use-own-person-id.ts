import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@taskdesk/libs";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

/** The server's self identity, not a role-name or workspace-membership inference. */
export function useOwnPersonId(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["me", "identity", user?.id],
    enabled: enabled && Boolean(user?.id),
    queryFn: async () => {
      const response = await apiFetch(getApiUrl("/me/identity"), {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok)
        throw new HttpError(response.status, "Identity read failed");
      const result: unknown = await response.json();
      if (
        typeof result !== "object" ||
        result === null ||
        !("personId" in result) ||
        typeof result.personId !== "string" ||
        !("user" in result) ||
        typeof result.user !== "object" ||
        result.user === null ||
        !("id" in result.user) ||
        result.user.id !== user?.id ||
        !("credentialType" in result) ||
        result.credentialType !== "session"
      )
        throw new Error("Identity response was invalid");
      return result.personId;
    },
  });
}
