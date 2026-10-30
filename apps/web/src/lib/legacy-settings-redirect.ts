const LEGACY_PREFIX = "/agent/settings";
const ACCOUNT = "/dashboard/settings/account";
const WORKSPACE = "/dashboard/settings/workspace";

/** Old account pages under `/agent/settings/profile` and their account settings page (L-03). */
const PROFILE_PAGES: Record<string, string> = {
  "": `${ACCOUNT}/information`,
  "/api-keys": `${ACCOUNT}/developer`,
  "/notifications": `${ACCOUNT}/notifications`,
  "/appearance": `${ACCOUNT}/preferences`,
  "/security": `${ACCOUNT}/security`,
};

/**
 * Where an old `/agent/settings/*` URL lives now (L-03). `path` is the raw, still-encoded path,
 * so encoded ids such as `pa%2F1` reach the new page unchanged. Workspace pages keep the rest of
 * the path under `/dashboard/settings/workspace`; account, project and removed pages are the
 * exceptions.
 */
export function legacySettingsRedirectPath(path: string): string {
  // Routes match case-insensitively, so the fixed segments do too; ids keep their case.
  const rest =
    path.slice(0, LEGACY_PREFIX.length).toLowerCase() === LEGACY_PREFIX
      ? path.slice(LEGACY_PREFIX.length).replace(/\/+$/u, "")
      : "";
  const lower = rest.toLowerCase();
  const startsWith = (segment: string) =>
    lower === segment || lower.startsWith(`${segment}/`);
  if (rest !== "" && !rest.startsWith("/")) return `${WORKSPACE}/general`;
  if (rest === "" || lower === "/danger") return `${WORKSPACE}/general`;
  if (startsWith("/profile")) {
    const profileRest = rest.slice("/profile".length);
    const profileLower = profileRest.toLowerCase();
    if (
      profileLower === "/pending-actions" ||
      profileLower.startsWith("/pending-actions/")
    )
      return `${ACCOUNT}/pending-actions${profileRest.slice("/pending-actions".length)}`;
    return PROFILE_PAGES[profileLower] ?? `${ACCOUNT}/information`;
  }
  if (startsWith("/projects"))
    return `/dashboard/settings/projects${rest.slice("/projects".length)}`;
  // An older webhook link pointed at a nested integrations path that never existed.
  if (startsWith("/integrations/webhooks"))
    return `${WORKSPACE}/webhooks${rest.slice("/integrations/webhooks".length)}`;
  return `${WORKSPACE}${rest}`;
}

/** The full redirect target for an old settings `href` (path, search and hash kept). */
export function legacySettingsRedirectHref(href: string): string {
  const suffixStart = href.search(/[?#]/u);
  const path = suffixStart === -1 ? href : href.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : href.slice(suffixStart);
  return `${legacySettingsRedirectPath(path)}${suffix}`;
}
