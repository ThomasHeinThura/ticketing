import { AsyncLocalStorage } from "node:async_hooks";

/** `GM-7`: an impersonation session is capped at 30 minutes. */
export const IMPERSONATION_SESSION_SECONDS = 30 * 60;

/**
 * `GM-8`: the request-scoped identity of an impersonating administrator. The app-wide auth guard
 * runs every impersonated request inside this store; `appendAuditLog` falls back to it when a
 * caller did not name an impersonator, so each audit row written during an impersonated request
 * carries `impersonator_id` without every write site having to remember to pass it.
 */
const impersonatorStorage = new AsyncLocalStorage<{ impersonatorId: string }>();

export function runWithImpersonator<T>(
  impersonatorId: string,
  callback: () => T,
): T {
  return impersonatorStorage.run({ impersonatorId }, callback);
}

export function currentImpersonatorId(): string | null {
  return impersonatorStorage.getStore()?.impersonatorId ?? null;
}

/**
 * The Better Auth `admin` plugin is a session primitive only: its HTTP endpoints are refused
 * (`auth.ts` before-hook). Our own `/api/instance/*` routes are the one sanctioned caller of
 * exactly two of its endpoints, marked by this store so the hook can tell them apart from a
 * browser request to `/api/auth/admin/*`.
 */
const sanctionedAdminEndpoint = new AsyncLocalStorage<string>();

export const SANCTIONED_ADMIN_ENDPOINTS = [
  "/admin/impersonate-user",
  "/admin/stop-impersonating",
] as const;

export function runSanctionedAdminCall<T>(
  endpoint: (typeof SANCTIONED_ADMIN_ENDPOINTS)[number],
  callback: () => T,
): T {
  return sanctionedAdminEndpoint.run(endpoint, callback);
}

export function isSanctionedAdminEndpoint(path: string): boolean {
  return sanctionedAdminEndpoint.getStore() === path;
}
