const RESET_PATHS = new Set(["/auth/reset-password", "/reset-password"]);
let capturedToken: string | null = null;

/** Remove the capability before routing or providers can make requests. */
export function capturePasswordResetToken(
  browser: Pick<Window, "location" | "history"> = window,
): void {
  if (!RESET_PATHS.has(browser.location.pathname.replace(/\/+$/, ""))) return;
  const url = new URL(browser.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const fragmentTokens = fragment.getAll("token");
  const tokens = [...url.searchParams.getAll("token"), ...fragmentTokens];
  if (tokens.length === 0) return;
  url.searchParams.delete("token");
  fragment.delete("token");
  // Old query links can still be consumed, but new links use a fragment so the
  // token is never sent in the document request. Remove either form immediately.
  const hash = fragmentTokens.length ? fragment.toString() : url.hash.slice(1);
  browser.history.replaceState(
    browser.history.state,
    "",
    `${url.pathname}${url.search}${hash ? `#${hash}` : ""}`,
  );
  capturedToken = tokens.length === 1 ? (tokens[0] ?? null) : null;
}

export function readPasswordResetToken(): string {
  return capturedToken ?? "";
}

export function clearPasswordResetToken(): void {
  capturedToken = null;
}
