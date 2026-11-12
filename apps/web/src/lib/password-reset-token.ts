const RESET_PATHS = new Set(["/auth/reset-password", "/reset-password"]);
let capturedToken: string | null = null;

/** Remove the capability before routing or providers can make requests. */
export function capturePasswordResetToken(
  browser: Pick<Window, "location" | "history"> = window,
): void {
  if (!RESET_PATHS.has(browser.location.pathname.replace(/\/+$/, ""))) return;
  const url = new URL(browser.location.href);
  const tokens = url.searchParams.getAll("token");
  if (tokens.length === 0) return;
  url.searchParams.delete("token");
  // If history cannot be changed, do not render the app with a live URL capability.
  browser.history.replaceState(
    browser.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  capturedToken = tokens.length === 1 ? (tokens[0] ?? null) : null;
}

export function readPasswordResetToken(): string {
  return capturedToken ?? "";
}

export function clearPasswordResetToken(): void {
  capturedToken = null;
}
