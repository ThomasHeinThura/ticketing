import { useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  Outlet,
  type ParsedLocation,
  redirect,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { PageLoading } from "@/components/page-loading";
import { portalLazyContent } from "@/components/portal/portal-lazy-content";
import { PortalNotFoundPage as PortalNotFoundState } from "@/components/portal/portal-not-found";
import { PortalError as PortalErrorState } from "@/components/portal/portal-root-states";
import type { PortalShellUser } from "@/components/portal/portal-user-menu";
import { HttpError } from "@/lib/http-error";
import { importWithRetry } from "@/lib/lazy-retry";
import { portalAuthClient } from "@/lib/portal-auth-client";
import { safePortalRedirect } from "@/lib/portal-route-search";
import {
  organisationPortalState,
  type PortalStateMarker,
  readPortalStateMarker,
} from "@/lib/portal-state";

import queryClient, { portalSessionQueryKey } from "@/query-client";

// Sign-in does not need the sidebar runtime; signed-in navigation preloads it during the session read.
const PortalLayout = portalLazyContent<{
  children: ReactNode;
  user: PortalShellUser;
  portalUserId: string;
}>(
  () =>
    import("@/components/portal/portal-layout").then((module) => {
      module.preloadPortalChrome();
      return module;
    }),
  <PageLoading portal />,
);

const PortalFeatureOff = portalLazyContent<{ state: PortalStateMarker }>(
  () =>
    import("@/components/portal/portal-feature-off").then((module) => ({
      default: module.PortalFeatureOff,
    })),
  <PageLoading portal />,
);

/**
 * Finding #7: an unknown portal address (served by the host as 404 with the portal shell). It
 * renders in the root's outlet, so a signed-in customer keeps the portal layout; without a
 * session (the invitation frame) it offers sign-in instead of the dashboard.
 */
function PortalNotFound() {
  const { portalUserId } = Route.useRouteContext();
  return <PortalNotFoundState signedIn={Boolean(portalUserId)} />;
}

function PortalError({ reset, error }: { reset: () => void; error: unknown }) {
  const router = useRouter();
  // Clearing the boundary alone would show the same failed match again: run the root's
  // beforeLoad (the session read) once more, then clear it.
  const tryAgain = () => {
    void router.invalidate().finally(reset);
  };
  return <PortalErrorState reset={tryAgain} error={error} />;
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
  "use no memo";
  const location = useLocation();
  const { t } = useTranslation("portal");
  const { portalUserId, portalUser, portalState } = Route.useRouteContext();
  const session = useQuery<{ session: unknown; user?: { id: string } } | null>({
    queryKey: portalSessionQueryKey,
    enabled: false,
  });
  const router = useRouter();
  const sessionUserId = session.data?.session
    ? session.data.user?.id
    : undefined;
  // The guard follows the verified session DATA, not the latest fetch status: a failed refetch
  // keeps the last verified answer (B) but reports status "error", and A's shell must not return
  // then. A signed-out or malformed answer (null / no user id) still counts as a mismatch; with no
  // verified data at all the existing error and Retry path applies.
  const identityChanged =
    !portalState &&
    !isSignIn(location.pathname) &&
    session.data !== undefined &&
    sessionUserId !== portalUserId;
  useLayoutEffect(() => {
    if (identityChanged) document.title = t("navigation.title");
  }, [identityChanged, t]);
  useEffect(() => {
    if (identityChanged) void router.invalidate();
  }, [identityChanged, router]);
  // P3-R2-03: the host marked the portal as switched off (or unreadable) for this visitor.
  if (portalState) return <PortalFeatureOff state={portalState} />;
  if (identityChanged) return <PageLoading portal />;
  return isSignIn(location.pathname) ? (
    <Outlet />
  ) : (
    <PortalLayout
      key={portalUserId}
      portalUserId={portalUserId}
      user={portalUser ?? anonymousUser}
    >
      <Outlet />
    </PortalLayout>
  );
}

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const portalState = readPortalStateMarker();
    if (portalState)
      return { portalState, portalUserId: undefined, portalUser: undefined };
    if (isSignIn(location.pathname)) return;
    void PortalLayout.preload().catch(() => undefined);
    if (location.pathname === "/")
      void importWithRetry(
        () => import("@/hooks/queries/portal/prefetch-portal-home"),
      ).catch(() => undefined);
    const session = await readCachedPortalSession();
    if (!session?.session || typeof session.user?.id !== "string") {
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
