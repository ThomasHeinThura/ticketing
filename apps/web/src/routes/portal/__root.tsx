import {
  createRootRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import PortalLayout from "@/components/portal/portal-layout";
import type { PortalShellUser } from "@/components/portal/portal-user-menu";
import { portalAuthClient } from "@/lib/portal-auth-client";

// Rarely shown, so kept out of the portal's initial bundle (G11 budget).
const PortalFeatureOff = lazy(() =>
  import("@/components/portal/portal-feature-off").then((module) => ({
    default: module.PortalFeatureOff,
  })),
);

// The not-found and error frames are rare too; both load on demand.
const PortalNotFoundState = lazy(() =>
  import("@/components/portal/portal-root-states").then((module) => ({
    default: module.PortalNotFound,
  })),
);
const PortalErrorState = lazy(() =>
  import("@/components/portal/portal-root-states").then((module) => ({
    default: module.PortalError,
  })),
);

function PortalNotFound() {
  return (
    <Suspense fallback={null}>
      <PortalNotFoundState />
    </Suspense>
  );
}

function PortalError({ reset }: { reset: () => void }) {
  return (
    <Suspense fallback={null}>
      <PortalErrorState reset={reset} />
    </Suspense>
  );
}

// The sign-in and accept-invitation pages are their own frame and are reachable without a session
// (the invitee signs in from the accept page).
const isSignIn = (pathname: string) =>
  pathname === "/sign-in" ||
  pathname === "/portal/sign-in" ||
  pathname.startsWith("/invite/");

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
    const result = await portalAuthClient.getSession();
    if (result.error || !result.data?.session)
      throw redirect({
        to: "/sign-in",
        search: { stage: "email", factor: "totp" },
      });
    const userId = result.data.user.id;
    return {
      portalUserId: userId,
      portalUser: shellUser(result.data.user),
      portalState: await organisationPortalState(userId),
    };
  },
  component: PortalRoot,
  notFoundComponent: PortalNotFound,
  errorComponent: PortalError,
});
