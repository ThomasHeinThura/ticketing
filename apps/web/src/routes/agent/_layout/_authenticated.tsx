import {
  createFileRoute,
  ErrorComponent,
  type ErrorComponentProps,
  Outlet,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { primeCsrfToken } from "@taskdesk/libs";
import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { ImpersonationBanner } from "@/components/god-mode/impersonation-banner";
import { getApiUrl } from "@/fetchers/get-api-url";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import {
  factorsPassed,
  peekAgentSession,
  rememberFactorsPassed,
  resolveAgentSession,
  type SessionData,
} from "@/lib/agent-session";
import { isGodModePath } from "@/lib/god-mode-paths";
import { TerminologyProvider } from "@/lib/i18n/terminology-provider";

export { SESSION_RETRY_DELAYS_MS } from "@/lib/agent-session";

/** Raised when get-session is still failing transiently after every retry. */
export class SessionUnavailableError extends Error {
  constructor() {
    super("The session check is temporarily unavailable.");
    this.name = "SessionUnavailableError";
  }
}

function readFactorStatus(): Promise<Response | null> {
  return fetch(getApiUrl("me/security/factors"), {
    credentials: "include",
    cache: "no-store",
  }).catch(() => null);
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

/**
 * GM-11: an impersonation session is marked by `impersonatedBy` on the resolved session. Only
 * then is the shell wrapped so the banner sits above the inherited frame; every other session
 * renders the bare outlet exactly as before.
 */
function AuthenticatedShell() {
  const { session } = Route.useRouteContext();
  const { i18n } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const impersonated = Boolean(
    (session?.session as { impersonatedBy?: string | null } | undefined)
      ?.impersonatedBy,
  );
  const content = !impersonated ? (
    <Outlet />
  ) : (
    <div className="flex h-svh flex-col">
      <ImpersonationBanner />
      <div className="relative min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
  return (
    <TerminologyProvider
      audience="agent"
      locale={i18n.resolvedLanguage ?? i18n.language}
      workspaceId={workspace?.id}
    >
      {content}
    </TerminologyProvider>
  );
}

// protects all child routes, must be logged in
export const Route = createFileRoute("/_layout/_authenticated")({
  component: AuthenticatedShell,
  errorComponent: SessionRouteError,
  beforeLoad: async ({ location, context }) => {
    const { queryClient } = context;
    const checkFactors =
      location.pathname !== "/dashboard/settings/account/security";
    let factorsRequest: Promise<Response | null> | null = null;
    // D9: a session identity that already passed the factor check is not asked again on each
    // navigation. A new session (sign-in, rotation, another user) is asked once more, and a
    // "required but not enrolled" answer is never remembered. The API still refuses every
    // request from a session that must enrol (`mfa_enrollment_required`); that refusal drops
    // the kept answer and re-runs this check (`recoverFactorEnrollment`).
    if (
      checkFactors &&
      !factorsPassed(queryClient, peekAgentSession(queryClient))
    ) {
      // Start the independent enforcement read alongside session refresh. Its
      // result is consumed only after session resolution, so redirect
      // precedence remains unchanged for logged-out users.
      factorsRequest = readFactorStatus();
    }

    let session: SessionData = null;
    let sessionError = false;
    const lookup = await resolveAgentSession(queryClient);
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
      // God Mode has its own sign-in page (password and MFA only, no SSO); every other agent
      // page uses the normal one. Same session, same enforcement below (L-03 option A).
      throw redirect({
        to: isGodModePath(location.pathname)
          ? "/god-mode/sign-in"
          : "/auth/sign-in",
        search: {
          redirect: location.href,
        },
      });
    }
    // Signed in: read the session's CSRF token alongside the screen's first reads, so the first
    // unsafe request (My work's search, a first edit) does not wait one more round trip for it.
    // Only the first call per page load reads (`@taskdesk/libs`).
    if (session) primeCsrfToken();
    if (session && factorsRequest) {
      let enrollmentRequired = false;
      try {
        let response = await factorsRequest;
        // A session refresh may rotate the cookie after the parallel factor
        // request was sent. Retry once with the now-current cookie before
        // deciding whether enrollment is required.
        if (response?.status === 401) {
          response = await readFactorStatus();
        }
        if (response?.ok) {
          const factor = (await response.json()) as {
            required: boolean;
            enabled: boolean;
          };
          if (factor.required && !factor.enabled) {
            enrollmentRequired = true;
          } else {
            rememberFactorsPassed(queryClient, session);
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
