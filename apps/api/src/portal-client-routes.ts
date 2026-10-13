/**
 * Registered portal client routes (CP-19).
 *
 * The portal host serves its own `index.html` for exactly these client-side routes so a
 * customer can open, reload or bookmark them. Every other extensionless portal path stays
 * 404, and the portal never falls back to agent files. A `$name` segment matches exactly
 * one non-empty path segment.
 *
 * Single source of truth: `tests/api/two-entry-host.test.ts` asserts this list equals the
 * `fullPaths` of `apps/web/src/routeTree.portal.gen.ts`, so a new portal route cannot be
 * added without updating this list.
 */
export const PORTAL_CLIENT_ROUTE_PATTERNS: readonly string[] = [
  "/",
  "/catalogue",
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
