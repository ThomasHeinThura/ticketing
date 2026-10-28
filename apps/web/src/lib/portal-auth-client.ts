import { getApiUrl } from "../fetchers/get-api-url";

export function getPortalAuthBaseURL() {
  // Reuse getApiUrl (the single VITE_API_URL reader). A same-origin build
  // (VITE_API_URL="") yields a relative "/api/" path, which is not a
  // parseable URL, so the base is "" and the client resolves against the
  // current origin.
  try {
    return new URL(getApiUrl("/")).origin;
  } catch {
    return "";
  }
}

type AuthError = { status: number; message?: string };
type AuthResult<T> = { data: T | null; error: AuthError | null };
type PortalSession = {
  session: { id: string } & Record<string, unknown>;
  user: { id: string } & Record<string, unknown>;
};

async function authFetch<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {},
): Promise<AuthResult<T>> {
  const response = await fetch(`${getPortalAuthBaseURL()}/api/auth${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : undefined;
    return { data: null, error: { status: response.status, message } };
  }
  return { data: payload as T, error: null };
}

/**
 * Minimal auth surface for the customer bundle: plain fetch against the better-auth endpoints,
 * with better-auth's `{ data, error }` result shape. The full client (factors, providers) loads
 * lazily from `portal-auth-providers`; keeping it out of first paint holds the G11 portal budget.
 */
export const portalAuthClient = {
  getSession: () => authFetch<PortalSession | null>("/get-session"),
  signIn: {
    email: (body: { email: string; password: string }) =>
      authFetch<{ twoFactorRedirect?: boolean } & Record<string, unknown>>(
        "/sign-in/email",
        { method: "POST", body },
      ),
  },
  signOut: () =>
    authFetch<{ success: boolean }>("/sign-out", { method: "POST", body: {} }),
  $fetch: <T = unknown>(
    path: string,
    init: { method?: "GET" | "POST"; body?: Record<string, unknown> },
  ) => authFetch<T>(path, init),
};
