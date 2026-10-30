import { getSafeRedirectPath } from "./safe-redirect";

/** God Mode lives at the agent host root (L-03, Thomas 30 Oct, option A). */
export const GOD_MODE_HOME = "/god-mode";
export const GOD_MODE_SIGN_IN = "/god-mode/sign-in";
const LEGACY_PREFIX = "/agent/god-mode";

/** Whether a pathname is God Mode. Routes match case-insensitively, so this does too. */
export function isGodModePath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return lower === GOD_MODE_HOME || lower.startsWith(`${GOD_MODE_HOME}/`);
}

function isGodModeSignInPath(pathname: string): boolean {
  return pathname.toLowerCase().replace(/\/+$/u, "") === GOD_MODE_SIGN_IN;
}

/**
 * Where the God Mode sign-in sends the user afterwards: a safe same-origin God Mode path, never
 * the sign-in page itself and never anywhere outside God Mode. Anything else opens God Mode home.
 */
export function godModeRedirectPath(value: string | undefined | null): string {
  const safe = getSafeRedirectPath(value);
  if (!safe) return GOD_MODE_HOME;
  const path = safe.split(/[?#]/u, 1)[0] ?? "";
  if (!isGodModePath(path) || isGodModeSignInPath(path)) return GOD_MODE_HOME;
  return safe;
}

/**
 * The God Mode URL of an old `/agent/god-mode[/*]` link (L-03). `href` is the raw, still-encoded
 * href; the rest of the path, the search and the hash are kept. The fixed prefix matches
 * case-insensitively, as routes do; ids keep their case.
 */
export function legacyGodModeRedirectHref(href: string): string {
  const suffixStart = href.search(/[?#]/u);
  const path = suffixStart === -1 ? href : href.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : href.slice(suffixStart);
  if (path.slice(0, LEGACY_PREFIX.length).toLowerCase() !== LEGACY_PREFIX)
    return GOD_MODE_HOME;
  const rest = path.slice(LEGACY_PREFIX.length).replace(/\/+$/u, "");
  if (rest !== "" && !rest.startsWith("/")) return GOD_MODE_HOME;
  return `${GOD_MODE_HOME}${rest}${suffix}`;
}
