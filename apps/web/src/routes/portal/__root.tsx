import {
  createRootRoute,
  Outlet,
  type ParsedLocation,
  redirect,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import PortalLayout from "@/components/portal/portal-layout";
import type { PortalShellUser } from "@/components/portal/portal-user-menu";
import { HttpError } from "@/lib/http-error";
import { portalAuthClient } from "@/lib/portal-auth-client";
import { safePortalRedirect } from "@/lib/routes";
import queryClient, { portalSessionQueryKey } from "@/query-client";

// Rarely shown, so kept out of the portal's initial bundle (G11 budget).
const PortalFeatureOff = lazy(() =>
  import("@/components/portal/portal-feature-off").then((module) => ({
    default: module.PortalFeatureOff,
  })),
);

// The not-found and error frames are rare too; both load on demand.
const PortalNotFoundState = lazy(() =>
  import("@/components/portal/portal-not-found").then((module) => ({
    default: module.PortalNotFoundPage,
  })),
);
const PortalErrorState = lazy(() =>
  import("@/components/portal/portal-root-states").then((module) => ({
    default: module.PortalError,
  })),
);

/**
 * Finding #7: an unknown portal address (served by the host as 404 with the portal shell). It
 * renders in the root's outlet, so a signed-in customer keeps the portal layout; without a
 * session (the invitation frame) it offers sign-in instead of the dashboard.
 */
function PortalNotFound() {
  const { portalUserId } = Route.useRouteContext();
  return (
    <Suspense fallback={null}>
      <PortalNotFoundState signedIn={Boolean(portalUserId)} />
    </Suspense>
  );
}

function PortalError({ reset, error }: { reset: () => void; error: unknown }) {
  const router = useRouter();
  // Clearing the boundary alone would show the same failed match again: run the root's
  // beforeLoad (the session read) once more, then clear it.
  const tryAgain = () => {
    void router.invalidate().finally(reset);
  };
  return (
    <Suspense fallback={null}>
      <PortalErrorState reset={tryAgain} error={error} />
    </Suspense>
  );
}

// The sign-in and accept-invitation pages are their own frame and are reachable without a session
// (the invitee signs in from the accept page).
const isSignIn = (pathname: string) =>
  pathname === "/sign-in" ||
  pathname === "/forgot-password" ||
  pathname === "/reset-password" ||
  pathname === "/portal/sign-in" ||
  pathname.startsWith("/invite/");

/**
 * The session is read on every navigation, so it is cached briefly (and shared by the two
 * beforeLoad runs of one navigation and by hover preloads). Sign-in and sign-out clear the
 * whole cache; a 401 removes it in the query cache. A dropped connection or a server failure is
 * retried quickly before the root shows its error state.
 */
const SESSION_STALE_MS = 30_000;
const SESSION_RETRY_DELAYS_MS = [250, 750];

/**
 * A dropped connection (a fetch `TypeError`) and a server failure (5xx) throw, so they are
 * retried; any other refusal or an empty session means signed out (`null`). Never a 401 error:
 * the shared query cache would treat that as the agent app's sign-out.
 */
async function readPortalSession() {
  const result = await portalAuthClient.getSession();
  if (result.error) {
    if (result.error.status >= 500)
      throw new HttpError(
        result.error.status,
        "session_unavailable",
        result.error.requestId,
      );
    return null;
  }
  return result.data?.session ? result.data : null;
}

function readCachedPortalSession() {
  return queryClient.fetchQuery({
    queryKey: portalSessionQueryKey,
    queryFn: readPortalSession,
    staleTime: SESSION_STALE_MS,
    retry: (failureCount, error) =>
      failureCount < SESSION_RETRY_DELAYS_MS.length &&
      shouldRetrySession(error),
    retryDelay: (failureCount) =>
      SESSION_RETRY_DELAYS_MS[failureCount] ?? SESSION_RETRY_DELAYS_MS[0],
  });
}

function shouldRetrySession(error: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return false;
  return (
    error instanceof TypeError ||
    (error instanceof HttpError && error.status >= 500)
  );
}

/** The page to return to after sign-in: path and query only, never the hash. */
function signInReturnPath(location: ParsedLocation) {
  if (location.pathname === "/") return undefined;
  return safePortalRedirect(`${location.pathname}${location.searchStr}`);
}

const anonymousUser: PortalShellUser = { name: "", email: "", image: null };

/** Name, email and image for the avatar menu, from the session the root already reads. */
function shellUser(user: Record<string, unknown>): PortalShellUser {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    name: text(user.name),
    email: text(user.email),
    image: text(user.image) || null,
  };
}

function PortalRoot() {
  const location = useLocation();
  const { portalUserId, portalUser, portalState } = Route.useRouteContext();
  // P3-R2-03: the host marked the portal as switched off (or unreadable) for this visitor.
  if (portalState)
    return (
      <Suspense fallback={null}>
        <PortalFeatureOff state={portalState} />
      </Suspense>
    );
  return isSignIn(location.pathname) ? (
    <Outlet />
  ) : (
    <PortalLayout key={portalUserId} user={portalUser ?? anonymousUser}>
      <Outlet />
    </PortalLayout>
  );
}

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    // Loaded on demand so the portal's initial bundle stays inside its G11 budget.
    const { readPortalStateMarker, organisationPortalState } = await import(
      "@/lib/portal-state"
    );
    const portalState = readPortalStateMarker();
    if (portalState)
      return { portalState, portalUserId: undefined, portalUser: undefined };
    if (isSignIn(location.pathname)) return;
    const session = await readCachedPortalSession();
    if (!session) {
      // Never keep "signed out" cached: the next navigation after sign-in must read it again.
      queryClient.removeQueries({ queryKey: portalSessionQueryKey });
      const returnTo = signInReturnPath(location);
      throw redirect({
        to: "/sign-in",
        search: {
          stage: "email",
          factor: "totp",
          ...(returnTo ? { redirect: returnTo } : {}),
        },
      });
    }
    const userId = session.user.id;
    return {
      portalUserId: userId,
      portalUser: shellUser(session.user),
      portalState: await organisationPortalState(userId),
    };
  },
  component: PortalRoot,
  notFoundComponent: PortalNotFound,
  errorComponent: PortalError,
});
