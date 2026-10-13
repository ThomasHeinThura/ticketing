import {
  createFileRoute,
  ErrorComponent,
  type ErrorComponentProps,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { getApiUrl } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";

/**
 * Backoff between get-session retries when the check is rate limited (429) or
 * the API is transiently failing (5xx / network). The total wait is bounded to
 * the sum of these delays; there is no unbounded retry loop.
 */
export const SESSION_RETRY_DELAYS_MS = [250, 750, 1500] as const;

/** Raised when get-session is still failing transiently after every retry. */
export class SessionUnavailableError extends Error {
  constructor() {
    super("The session check is temporarily unavailable.");
    this.name = "SessionUnavailableError";
  }
}

// A 429/408/5xx or a network-level failure (no HTTP status) says nothing about
// whether the user is signed in, so it must never be treated as "signed out".
function isTransientSessionFailure(error: { status?: number }): boolean {
  const status = error.status;
  return (
    status === undefined ||
    status === 0 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

type SessionLookup =
  | { kind: "resolved"; session: SessionData }
  | { kind: "threw" }
  | { kind: "transient" };

async function lookupSession(): Promise<SessionLookup> {
  let last: SessionLookup = { kind: "transient" };
  for (let attempt = 0; attempt <= SESSION_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, SESSION_RETRY_DELAYS_MS[attempt - 1]),
      );
    }
    try {
      const { data, error } = await authClient.getSession();
      if (!error || !isTransientSessionFailure(error)) {
        // 200 (data may be null = signed out) or a definitive 4xx such as 401.
        return { kind: "resolved", session: data };
      }
      last = { kind: "transient" };
    } catch (error) {
      if (import.meta.env.DEV) console.warn("getSession failed", error);
      last = { kind: "threw" };
    }
  }
  return last;
}

function SessionRouteError({ error }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  if (!(error instanceof SessionUnavailableError)) {
    return <ErrorComponent error={error} />;
  }
  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-background p-6"
    >
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-foreground">
          {t("common:error.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("common:error.sessionUnavailable")}
        </p>
        <Button
          type="button"
          className="mt-4"
          onClick={() => void router.invalidate()}
        >
          {t("common:error.tryAgain")}
        </Button>
      </div>
    </div>
  );
}

// protects all child routes, must be logged in
export const Route = createFileRoute("/_layout/_authenticated")({
  errorComponent: SessionRouteError,
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

    let session: SessionData = null;
    let sessionError = false;
    const lookup = await lookupSession();
    if (lookup.kind === "resolved") {
      session = lookup.session;
    } else if (lookup.kind === "threw") {
      // getSession() kept rejecting (e.g. network error) — treat the session
      // as unknown and let child routes decide whether mutations are safe.
      sessionError = true;
    } else {
      // Rate limited / transient server failure after bounded retries. This
      // is not a sign-out: keep the user on the page with a retryable state.
      throw new SessionUnavailableError();
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
