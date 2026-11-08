import type { QueryClient } from "@tanstack/react-query";
import { onFactorEnrollmentRequired } from "@taskdesk/libs";
import { authClient } from "@/lib/auth-client";

/**
 * The agent session, kept in the query client so a navigation does not wait for `get-session`
 * (S7b, D9 approved 31 Oct). The API stays the enforcement authority: every request checks the
 * session, factor enrollment (`mfa_enrollment_required`) and step-up proofs on its own, so this
 * cache only decides when the shell re-reads them.
 *
 * - A cached session is used at once. Once it is older than {@link SESSION_STALE_MS} it is
 *   re-read in the background; a sign-out or a different identity found there clears the cache
 *   and re-runs the route checks, which then redirect.
 * - Better Auth's `useSession` store seeds the cache: it reads the session before the router
 *   mounts (`AuthProvider` waits for it), so the first navigation needs no second read.
 * - Any session signal (sign-in, sign-out, revoke, password change, workspace switch, another
 *   tab's sign-out) clears the cache, and the next navigation reads the session again.
 * - Factor status is kept per session identity only when it does not block the user. A
 *   "required but not enrolled" answer is never kept, so it is re-checked on every navigation.
 * - A kept factor answer can go out of date without a session signal (an administrator requires
 *   factors or resets this user's factor, or the user's role moves under the policy). The API
 *   then refuses calls with `403 mfa_enrollment_required`; that refusal drops the kept answer and
 *   re-runs the route checks, which lead to enrolment ({@link recoverFactorEnrollment}).
 */

/**
 * How long a cached session is used without a background re-read. One minute keeps a revoked
 * session's shell short-lived (every API call is already refused at once) while sparing every
 * click a `get-session` round trip. It is not a gated threshold.
 */
export const SESSION_STALE_MS = 60_000;

/**
 * Backoff between get-session retries when the check is rate limited (429) or
 * the API is transiently failing (5xx / network). The total wait is bounded to
 * the sum of these delays; there is no unbounded retry loop.
 */
export const SESSION_RETRY_DELAYS_MS = [250, 750, 1500] as const;

export const agentSessionKeys = {
  all: ["agent-auth"] as const,
  session: () => ["agent-auth", "session"] as const,
  factorsPassed: (userId: string, sessionId: string) =>
    ["agent-auth", "factors-passed", userId, sessionId] as const,
  allFactors: () => ["agent-auth", "factors-passed"] as const,
};

export type SessionData = Awaited<
  ReturnType<typeof authClient.getSession>
>["data"];

export type SessionLookup =
  | { kind: "resolved"; session: SessionData }
  | { kind: "threw" }
  | { kind: "transient" };

// A 429/408/5xx or a network-level failure (no HTTP status) says nothing about
// whether the user is signed in, so it must never be treated as "signed out".
function isTransientSessionFailure(error: { status?: number }): boolean {
  const status = error.status;
  return (
    status === undefined ||
    status === 0 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

export async function lookupSession(): Promise<SessionLookup> {
  let last: SessionLookup = { kind: "transient" };
  for (let attempt = 0; attempt <= SESSION_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, SESSION_RETRY_DELAYS_MS[attempt - 1]),
      );
    }
    try {
      const { data, error } = await authClient.getSession();
      if (!error || !isTransientSessionFailure(error)) {
        // 200 (data may be null = signed out) or a definitive 4xx such as 401.
        return { kind: "resolved", session: data };
      }
      last = { kind: "transient" };
    } catch (error) {
      if (import.meta.env.DEV) console.warn("getSession failed", error);
      last = { kind: "threw" };
    }
  }
  return last;
}

type SignedInSession = NonNullable<SessionData>;

/** The user and session ids, the identity a cached factor answer belongs to. */
export function sessionIdentity(
  session: SessionData | undefined,
): { userId: string; sessionId: string } | null {
  const userId = session?.user?.id;
  const sessionId = session?.session?.id;
  if (typeof userId !== "string" || typeof sessionId !== "string") return null;
  return { userId, sessionId };
}

function sameIdentity(a: SessionData | undefined, b: SessionData | undefined) {
  const left = sessionIdentity(a);
  const right = sessionIdentity(b);
  return (
    left !== null &&
    right !== null &&
    left.userId === right.userId &&
    left.sessionId === right.sessionId
  );
}

function hasExpired(session: SignedInSession): boolean {
  const expiresAt = (session.session as { expiresAt?: unknown } | undefined)
    ?.expiresAt;
  if (expiresAt === undefined || expiresAt === null) return false;
  const time = new Date(expiresAt as string | number | Date).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

const configured = new WeakSet<QueryClient>();
const inFlight = new WeakMap<QueryClient, Promise<SessionLookup>>();
let onIdentityChanged: (() => void) | undefined;

function configure(queryClient: QueryClient) {
  if (configured.has(queryClient)) return;
  configured.add(queryClient);
  // Nothing observes these entries, so keep them past the default five-minute collection.
  queryClient.setQueryDefaults(agentSessionKeys.all, {
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/** Forgets the cached session and every cached factor answer. */
export function clearAgentSession(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: agentSessionKeys.all });
}

function storeSession(queryClient: QueryClient, session: SignedInSession) {
  configure(queryClient);
  const previous = queryClient.getQueryData<SessionData>(
    agentSessionKeys.session(),
  );
  if (previous && !sameIdentity(previous, session)) {
    queryClient.removeQueries({ queryKey: agentSessionKeys.allFactors() });
  }
  queryClient.setQueryData(agentSessionKeys.session(), session);
}

type SessionAtomValue = {
  data: SessionData;
  error: unknown;
  isPending: boolean;
  isRefetching: boolean;
};

type SessionAtom = {
  get: () => SessionAtomValue;
  listen: (cb: (value: SessionAtomValue) => void) => () => void;
};

function sessionAtoms() {
  return authClient.$store.atoms as unknown as {
    session: SessionAtom;
    $sessionSignal: { listen: (cb: () => void) => () => void };
  };
}

/** Set while {@link followAgentSession} keeps Better Auth's session store mounted. */
let followedAtom: SessionAtom | undefined;

/**
 * Better Auth's store reads the session once when the page starts. A route check made while
 * that first read is in flight (the work-list preload in `main.tsx`) waits for it instead of
 * sending a second `get-session`. Only a definitive answer is used; a transient failure falls
 * back to {@link lookupSession} and its bounded retries.
 */
function awaitFirstStoreRead(): Promise<SessionLookup | null> | null {
  const atom = followedAtom;
  if (!atom) return null;
  const current = atom.get();
  if (current.data || !current.isPending) return null;
  return new Promise((resolve) => {
    const stop = atom.listen((value) => {
      if (value.isPending) return;
      stop();
      if (value.data) {
        resolve({ kind: "resolved", session: value.data });
        return;
      }
      const error = value.error as { status?: number } | null | undefined;
      if (!error) resolve({ kind: "resolved", session: null });
      else if (
        typeof error.status === "number" &&
        !isTransientSessionFailure(error)
      )
        resolve({ kind: "resolved", session: null });
      else resolve(null);
    });
  });
}

/** One `get-session` read at a time per query client; concurrent callers share it. */
function readSession(queryClient: QueryClient): Promise<SessionLookup> {
  const pending = inFlight.get(queryClient);
  if (pending) return pending;
  const fromStore = awaitFirstStoreRead();
  const read = fromStore
    ? fromStore.then((lookup) => lookup ?? lookupSession())
    : lookupSession();
  const request = read.then((lookup) => {
    if (lookup.kind === "resolved") {
      if (lookup.session) storeSession(queryClient, lookup.session);
      else clearAgentSession(queryClient);
    }
    return lookup;
  });
  const settled = request.finally(() => {
    if (inFlight.get(queryClient) === settled) inFlight.delete(queryClient);
  });
  inFlight.set(queryClient, settled);
  return settled;
}

function revalidate(queryClient: QueryClient, cached: SignedInSession) {
  void readSession(queryClient).then((lookup) => {
    // A transient failure keeps the session: it says nothing about being signed out.
    if (lookup.kind !== "resolved") return;
    if (!lookup.session || !sameIdentity(cached, lookup.session)) {
      onIdentityChanged?.();
    }
  });
}

/**
 * Whether Better Auth's session store has already answered "signed out": its read finished with
 * no session and no transient failure. `false` while the store is unfollowed, still reading, or
 * failed transiently, since then nothing is known. A hint only, never a sign-in decision: the
 * route check still reads the session itself.
 */
export function storeAnsweredSignedOut(): boolean {
  const current = followedAtom?.get();
  if (!current || current.isPending || current.isRefetching || current.data)
    return false;
  const error = current.error as { status?: number } | null | undefined;
  return !error || !isTransientSessionFailure(error);
}

/** The cached, unexpired session, without reading or revalidating. */
export function peekAgentSession(
  queryClient: QueryClient,
): SignedInSession | undefined {
  const cached = queryClient.getQueryData<SessionData>(
    agentSessionKeys.session(),
  );
  if (!cached || hasExpired(cached)) return undefined;
  return cached;
}

/**
 * The session for a route check: the cached one when present (re-read in the background once
 * stale or invalidated), otherwise a fresh read. Only a definitive answer is cached; a thrown or
 * transient read is returned as it is and read again next time.
 */
export async function resolveAgentSession(
  queryClient: QueryClient,
): Promise<SessionLookup> {
  configure(queryClient);
  const cached = peekAgentSession(queryClient);
  if (cached) {
    const state = queryClient.getQueryState(agentSessionKeys.session());
    const stale =
      !state ||
      state.isInvalidated ||
      Date.now() - state.dataUpdatedAt >= SESSION_STALE_MS;
    if (stale) revalidate(queryClient, cached);
    return { kind: "resolved", session: cached };
  }
  return readSession(queryClient);
}

/** Whether this session identity already passed the factor-enrollment check. */
export function factorsPassed(
  queryClient: QueryClient,
  session: SessionData | undefined,
): boolean {
  const identity = sessionIdentity(session);
  if (!identity) return false;
  return (
    queryClient.getQueryData(
      agentSessionKeys.factorsPassed(identity.userId, identity.sessionId),
    ) === true
  );
}

/** Keeps a non-blocking factor answer for this session identity (D9). */
export function rememberFactorsPassed(
  queryClient: QueryClient,
  session: SessionData | undefined,
) {
  const identity = sessionIdentity(session);
  if (!identity) return;
  configure(queryClient);
  queryClient.setQueryData(
    agentSessionKeys.factorsPassed(identity.userId, identity.sessionId),
    true,
  );
}

/**
 * Called when the API refuses this session with `403 mfa_enrollment_required`: drops every kept
 * factor answer and, only when one was kept, re-runs the route checks (`onChanged`, the router's
 * `invalidate`), which read the factor status again and redirect to enrolment. With no kept
 * answer the route checks already ask on every navigation, so nothing is re-run; this also stops
 * a refused query on the security page from re-running the checks in a loop.
 * Returns whether the checks were re-run.
 */
export function recoverFactorEnrollment(
  queryClient: QueryClient,
  onChanged: () => void,
): boolean {
  const kept = queryClient
    .getQueriesData({ queryKey: agentSessionKeys.allFactors() })
    .some(([, passed]) => passed === true);
  queryClient.removeQueries({ queryKey: agentSessionKeys.allFactors() });
  if (kept) onChanged();
  return kept;
}

/**
 * Keeps the cached session in step with Better Auth's session store, once per page.
 * `onChanged` re-runs the route checks (the router's `invalidate`) when the signed-in identity
 * changes or ends, so a sign-out in another tab or a revoked session found on a background read
 * leaves the protected screens promptly, and a `403 mfa_enrollment_required` from any API call
 * leads back to enrolment.
 */
export function followAgentSession(
  queryClient: QueryClient,
  onChanged: () => void,
): () => void {
  configure(queryClient);
  onIdentityChanged = onChanged;
  const atoms = sessionAtoms();
  followedAtom = atoms.session;
  let known: SessionData = null;
  const stopSession = atoms.session.listen((value) => {
    if (value.isPending || value.isRefetching) return;
    if (value.data) {
      // A failed re-read keeps the last session; it neither refreshes nor ends the cache.
      if (value.error) return;
      const changed = known !== null && !sameIdentity(known, value.data);
      known = value.data;
      storeSession(queryClient, value.data as SignedInSession);
      if (changed) onChanged();
      return;
    }
    // Better Auth keeps the last session on a transient failure and drops it only on a
    // definitive answer (signed out, 401), so an empty value here means the session ended.
    if (value.error === null || value.error === undefined || known !== null) {
      const ended = known !== null;
      known = null;
      clearAgentSession(queryClient);
      if (ended) onChanged();
    }
  });
  const stopSignal = atoms.$sessionSignal.listen(() => {
    clearAgentSession(queryClient);
  });
  const stopFactorRefusal = onFactorEnrollmentRequired(() => {
    recoverFactorEnrollment(queryClient, onChanged);
  });
  return () => {
    stopSession();
    stopSignal();
    stopFactorRefusal();
    if (onIdentityChanged === onChanged) onIdentityChanged = undefined;
    if (followedAtom === atoms.session) followedAtom = undefined;
  };
}
