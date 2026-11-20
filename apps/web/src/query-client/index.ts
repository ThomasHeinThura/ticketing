import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import {
  HttpError,
  handleUnauthorized,
  isUnauthorizedError,
} from "@/lib/http-error";
import { followAuditInvalidation, historyHooks } from "./audit-invalidation";
import { configureNotifyScheduler } from "./notify-scheduler";

configureNotifyScheduler();

// TanStack raises these before any fetcher-level message exists; CORS rejections
// from the browser also surface here. Used to limit auto-retry to online tabs and
// to tag the captured event so offline-tab reloads don't drown the queue.
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("Failed to fetch") ||
    error.message.includes("NetworkError") ||
    error.message.includes("Load failed") ||
    error.message.includes("CORS")
  );
}

// Cancellation surfaces as AbortError from the fetch signal and from TanStack's
// own query cancellation. Treat both as expected control flow, not a failure.
function isCancellationError(error: Error): boolean {
  return (
    error.name === "AbortError" ||
    error.message.toLowerCase().includes("aborted")
  );
}

// In-module cooldown so an offline tab doesn't log one error per cache
// entry on every retry tick. Network-class only; API errors are not rate-limited.
const NETWORK_REPORT_COOLDOWN_MS = 60_000;
const networkErrorCooldowns = new Map<string, number>();

/**
 * A module switched off answers `feature_disabled` (A-11: Reports, Pages, agile, time tracking).
 * Each screen shows that as its own "off" state, so it is not an error worth logging.
 */
function isFeatureDisabledError(error: Error): boolean {
  return error instanceof HttpError && error.message === "feature_disabled";
}

function captureCacheError(error: unknown, context: "query" | "mutation") {
  if (!(error instanceof Error)) return;
  if (isCancellationError(error)) return;
  if (isFeatureDisabledError(error)) return;

  const isNetwork = isNetworkError(error);
  const area = `${isNetwork ? "network" : "api"}.${context}`;

  if (isNetwork) {
    const dedupeKey = `${context}:${error.message}`;
    const lastSent = networkErrorCooldowns.get(dedupeKey);
    const now = Date.now();
    if (lastSent !== undefined && now - lastSent < NETWORK_REPORT_COOLDOWN_MS) {
      return;
    }
    networkErrorCooldowns.set(dedupeKey, now);
    // ponytail: hard cap with full clear; entries older than the cooldown are
    // useless to keep, and `error.message` can vary across fetchers/CORS
    // failures so the keyspace is unbounded in practice. Ceiling: 50 keys with a full clear.
    // Revisit bounded eviction if >50 distinct errors cause duplicate reports in one cooldown.
    if (networkErrorCooldowns.size > 50) networkErrorCooldowns.clear();
  }

  // kaneo sent this to Sentry. TaskDesk has no phone-home, so the error stays
  // in the browser console — still visible to whoever is debugging, and going
  // nowhere else. The cooldown above still applies, so an offline tab does not
  // log once per cache entry per retry tick.
  console.error(`[${area}]`, error);
}

/**
 * A refusal (4xx) answers the same on every retry: no access, not found, feature off. Retrying
 * only delays the right empty state (A-04, A-11). A timeout (408) or rate limit (429) may pass.
 */
function isFinalClientError(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * One dropped request (a closed connection, a 5xx) is retried twice with TanStack's backoff
 * (1 s, then 2 s) before a screen shows its error state. A dropped request is retried only while
 * the browser is online, so an offline tab does not keep trying. A 4xx refusal is final.
 */
export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (isUnauthorizedError(error) || isFinalClientError(error)) return false;
  if (isNetworkError(error)) return isOnline() && failureCount < 2;
  return failureCount < 2;
}

/** The portal root's cached session read (`routes/portal/__root.tsx`). */
export const portalSessionQueryKey = ["portal", "session"] as const;
export function createQueryClient() {
  let verifiedPortalUserId: string | undefined;
  const auditWrites = new WeakMap<
    object,
    {
      meta: import("./audit-invalidation").AuditMutationMeta | undefined;
      variables: unknown;
    }
  >();
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onSuccess: (data, query) => {
        const key = query.queryKey;
        if (key.length !== 2 || key[0] !== "portal" || key[1] !== "session")
          return;
        const user =
          data && typeof data === "object" && "user" in data
            ? data.user
            : undefined;
        const hasSession = Boolean(
          data && typeof data === "object" && "session" in data && data.session,
        );
        const userId =
          hasSession &&
          user &&
          typeof user === "object" &&
          "id" in user &&
          typeof user.id === "string"
            ? user.id
            : undefined;
        // Remove and cancel old reads before a different verified identity can use shared keys.
        if (
          verifiedPortalUserId !== undefined &&
          verifiedPortalUserId !== userId
        ) {
          client.removeQueries({
            predicate: ({ queryKey }) =>
              (queryKey[0] === "portal" &&
                !(
                  queryKey.length === 2 &&
                  (queryKey[1] === "session" || queryKey[1] === "auth-methods")
                )) ||
              (queryKey[0] === "terminology-runtime" &&
                queryKey[1] === "customer"),
          });
        }
        verifiedPortalUserId = userId;
      },
      onError: (error, query) => {
        if (isUnauthorizedError(error)) {
          client.removeQueries({ queryKey: portalSessionQueryKey });
          handleUnauthorized();
          return;
        }
        historyHooks.onRefusal?.(client, query, error);
        captureCacheError(error, "query");
      },
    }),
    mutationCache: new MutationCache({
      onMutate: (variables, mutation) => {
        auditWrites.set(mutation, { meta: mutation.meta, variables });
      },
      onSuccess: (data, _variables, _context, mutation) => {
        const captured = auditWrites.get(mutation);
        if (captured)
          historyHooks.onMutation?.(
            client,
            captured.meta,
            captured.variables,
            data,
          );
      },
      onError: (error) => captureCacheError(error, "mutation"),
    }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        retry: shouldRetryQuery,
      },
      mutations: { retry: false },
    },
  });
  followAuditInvalidation(client);
  return client;
}

const queryClient = createQueryClient();

export default queryClient;
