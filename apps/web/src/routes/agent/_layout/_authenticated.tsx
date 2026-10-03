import { createFileRoute, redirect } from "@tanstack/react-router";
import { getApiUrl } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";

// protects all child routes, must be logged in
export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ location }) => {
    const checkFactors =
      location.pathname !== "/dashboard/settings/account/security";
    let factorsRequest: Promise<Response | null> | null = null;
    if (checkFactors) {
      // Start the independent enforcement read alongside session refresh. Its
      // result is consumed only after session resolution, so redirect
      // precedence remains unchanged for logged-out users.
      factorsRequest = fetch(getApiUrl("me/security/factors"), {
        credentials: "include",
        cache: "no-store",
      }).catch(() => null);
    }

    let session = null;
    let sessionError = false;
    try {
      const { data } = await authClient.getSession();
      session = data;
    } catch (error) {
      sessionError = true;
      if (import.meta.env.DEV) console.warn("getSession failed", error);
      // getSession() rejected (e.g. network error) — treat the session as
      // unknown and let child routes decide whether mutations are safe.
    }
    if (!session && !sessionError) {
      // `location.search` is the router's *parsed* search object (built with
      // `Object.create(null)` — see @tanstack/router-core's qss decode), not
      // a string. When the query string is empty that object has no
      // properties and no prototype, so it has no `toString`/`valueOf`/
      // `Symbol.toPrimitive`, and `pathname + search + hash` throws
      // "Cannot convert object to primitive value" instead of producing a
      // path. That throw escaped this beforeLoad uncaught, leaving a
      // logged-out user on a blank page instead of the sign-in redirect
      // (#97). `location.href` is the router's own pathname+search+hash
      // string (see router-core's `buildLocation`), so use that directly
      // rather than re-deriving it from parts that aren't all strings.
      throw redirect({
        to: "/auth/sign-in",
        search: {
          redirect: location.href,
        },
      });
    }
    if (session && factorsRequest) {
      let enrollmentRequired = false;
      try {
        let response = await factorsRequest;
        // A session refresh may rotate the cookie after the parallel factor
        // request was sent. Retry once with the now-current cookie before
        // deciding whether enrollment is required.
        if (response?.status === 401) {
          response = await fetch(getApiUrl("me/security/factors"), {
            credentials: "include",
            cache: "no-store",
          }).catch(() => null);
        }
        if (response?.ok) {
          const factor = (await response.json()) as {
            required: boolean;
            enabled: boolean;
          };
          if (factor.required && !factor.enabled) {
            enrollmentRequired = true;
          }
        }
      } catch {
        // The API is the enforcement authority; a transient status lookup
        // must not prevent rendering the recovery/enrollment entry point.
      }
      if (enrollmentRequired) {
        throw redirect({
          to: "/dashboard/settings/account/security",
          search: { enrollmentRequired: true },
        });
      }
    }
    return { session, sessionError };
  },
});
