/**
 * Registered portal client routes (CP-19).
 *
 * The portal host serves its own `index.html` for exactly these client-side routes so a
 * customer can open, reload or bookmark them. Every other extensionless portal path stays
 * 404: it carries the same portal shell so the portal app renders its branded not-found page
 * (asset paths stay a plain 404), and the portal never falls back to agent files. A `$name`
 * segment matches exactly one non-empty path segment.
 *
 * Single source of truth: `tests/api/two-entry-host.test.ts` asserts this list equals the
 * `fullPaths` of `apps/web/src/routeTree.portal.gen.ts`, so a new portal route cannot be
 * added without updating this list.
 */
export const PORTAL_CLIENT_ROUTE_PATTERNS: readonly string[] = [
  "/",
  "/account",
  // D7: announcements; release notes stay at /releases as its second tab.
  "/announcements",
  "/announcements/$id",
  "/notifications",
  "/catalogue",
  // Password recovery: the request page, and the reset page opened from the emailed link.
  "/forgot-password",
  "/reset-password",
  // CP-24: the accept-invitation page. The credential rides in the fragment, never the path.
  "/invite/$id",
  "/kb",
  "/kb/$id",
  // Redirects to /kb on the client; kept because the sidebar label and old links say
  // "knowledge base".
  "/knowledge-base",
  "/releases",
  "/releases/$id",
  "/approvals",
  // S4c: the organisation's projects and one project's details.
  "/projects",
  "/projects/$projectKey",
  // Redirects to /requests on the client; kept because customers bookmark it.
  "/portal/requests",
  // Redirects to /sign-in on the client; kept because customers already have the link.
  "/portal/sign-in",
  "/requests",
  // Redirects to /account on the client; kept because the sidebar label says "Settings".
  "/settings",
  // U-12: a request the team raised for the customer (D6), opened by its key.
  "/requests/$ref",
  "/sign-in",
  "/submissions/$ref",
];

const compiled = PORTAL_CLIENT_ROUTE_PATTERNS.map((pattern) =>
  pattern === "/" ? [] : pattern.slice(1).split("/"),
);

export function isPortalClientRoute(path: string): boolean {
  if (!path.startsWith("/")) return false;
  const segments = path === "/" ? [] : path.slice(1).split("/");
  return compiled.some(
    (pattern) =>
      pattern.length === segments.length &&
      pattern.every((part, index) => {
        const segment = segments[index] ?? "";
        if (segment === "") return false;
        return part.startsWith("$") ? true : part === segment;
      }),
  );
}
