// Agent emails link to the account notifications page (L-03); emails sent before L-03 still
// carry the old `/agent/settings/profile/notifications` entry, which keeps working.
const HANDOFF_PATHS = new Map<string, "agent" | "customer">([
  ["/dashboard/settings/account/notifications", "agent"],
  ["/agent/settings/profile/notifications", "agent"],
  ["/account", "customer"],
]);
const DEADLINE_MS = 5000;
let preferenceHandoffAttempted = false;

/** A non-secret in-memory signal for showing the generic invalid-link message. */
export function consumeNotificationPreferenceHandoffAttempted() {
  const attempted = preferenceHandoffAttempted;
  preferenceHandoffAttempted = false;
  return attempted;
}

/** Consume the email fragment before routing, auth redirects, or providers run.
 * The signed capability remains only in this short-lived closure and the POST body.
 */
export function initializeNotificationPreferenceHandoff(
  browser: Pick<Window, "location" | "history"> = window,
  fetcher: typeof fetch = fetch,
  deadlineMs = DEADLINE_MS,
): Promise<void> {
  const fragment = new URLSearchParams(browser.location.hash.slice(1));
  if (!fragment.has("preference_token")) return Promise.resolve();
  if (browser.location.pathname.replace(/\/$/, "") === "/account")
    preferenceHandoffAttempted = true;

  const tokens = fragment.getAll("preference_token");
  // Remove the whole fragment, including duplicate/invalid capabilities, before
  // doing anything asynchronous. Never copy it to a return URL or browser storage.
  try {
    browser.history.replaceState(
      browser.history.state,
      "",
      `${browser.location.pathname}${browser.location.search}`,
    );
  } catch {
    // Continuing to auth routing could copy the capability into a return URL.
    return Promise.reject(
      new Error("Unable to initialize notification preferences"),
    );
  }
  const token = tokens[0];
  const audience = HANDOFF_PATHS.get(
    browser.location.pathname.replace(/\/$/, ""),
  );
  if (
    !audience ||
    tokens.length !== 1 ||
    !token ||
    token.length > 4096 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)
  ) {
    return Promise.resolve();
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve();
    }, deadlineMs);
  });
  const exchange = async () => {
    try {
      const csrf = await fetcher(
        audience === "agent" ? "/api/me/csrf-token" : "/api/portal/csrf-token",
        {
          credentials: "include",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (csrf.ok) {
        const payload: unknown = await csrf.json();
        if (
          !payload ||
          typeof payload !== "object" ||
          !("token" in payload) ||
          typeof payload.token !== "string" ||
          !payload.token ||
          !("expiresAt" in payload) ||
          typeof payload.expiresAt !== "string"
        )
          return;
        headers["x-taskdesk-csrf"] = payload.token;
      } else if (csrf.status !== 401) {
        return;
      }
      if (controller.signal.aborted) return;
      // The generic public response is deliberately neither decoded nor rendered.
      await fetcher(
        `/api/public/${audience === "agent" ? "agent" : "portal"}/notification-preference-handoffs`,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          headers,
          body: JSON.stringify({ token }),
          signal: controller.signal,
        },
      );
    } catch {
      // Invalid/expired links and transport failures reveal no capability details.
    }
  };
  return Promise.race([exchange(), deadline]).finally(() =>
    clearTimeout(timeout),
  );
}
