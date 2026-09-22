import { createFileRoute, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

// protects all child routes, must be logged in
export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ location }) => {
    let session = null;
    let sessionError = false;
    try {
      const { data } = await authClient.getSession();
      session = data;
    } catch (error) {
      sessionError = true;
      if (import.meta.env.DEV) console.warn("getSession failed", error);
      // getSession() rejected (e.g. network error) — session state is
      // unknown. Don't conflate with "no session" (unauthenticated): let
      // children decide whether to skip active-organization mutations.
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
    return { session, sessionError };
  },
});
