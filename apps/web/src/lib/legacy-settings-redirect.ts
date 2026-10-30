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
  const rest = path.startsWith(LEGACY_PREFIX)
    ? path.slice(LEGACY_PREFIX.length).replace(/\/+$/u, "")
    : "";
  if (rest !== "" && !rest.startsWith("/")) return `${WORKSPACE}/general`;
  if (rest === "" || rest === "/danger") return `${WORKSPACE}/general`;
  if (rest === "/profile" || rest.startsWith("/profile/")) {
    const profileRest = rest.slice("/profile".length);
    if (
      profileRest === "/pending-actions" ||
      profileRest.startsWith("/pending-actions/")
    )
      return `${ACCOUNT}${profileRest}`;
    return PROFILE_PAGES[profileRest] ?? `${ACCOUNT}/information`;
  }
  if (rest === "/projects" || rest.startsWith("/projects/"))
    return `/dashboard/settings${rest}`;
  // An older webhook link pointed at a nested integrations path that never existed.
  if (
    rest === "/integrations/webhooks" ||
    rest.startsWith("/integrations/webhooks/")
  )
    return `${WORKSPACE}${rest.slice("/integrations".length)}`;
  return `${WORKSPACE}${rest}`;
}

/** The full redirect target for an old settings `href` (path, search and hash kept). */
export function legacySettingsRedirectHref(href: string): string {
  const suffixStart = href.search(/[?#]/u);
  const path = suffixStart === -1 ? href : href.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : href.slice(suffixStart);
  return `${legacySettingsRedirectPath(path)}${suffix}`;
}
