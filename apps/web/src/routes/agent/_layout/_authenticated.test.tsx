import { QueryClient } from "@tanstack/react-query";
import {
  defaultParseSearch,
  defaultStringifySearch,
} from "@tanstack/react-router";
import { createApiFetch } from "@taskdesk/libs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentSession,
  followAgentSession,
  SESSION_STALE_MS,
} from "@/lib/agent-session";
import {
  Route,
  SESSION_RETRY_DELAYS_MS,
  SessionUnavailableError,
} from "./_authenticated";

const getSession = vi.fn();
let queryClient = new QueryClient();

/** A minimal stand-in for Better Auth's nanostores session store and session signal. */
const atoms = vi.hoisted(() => {
  type Value = {
    data: unknown;
    error: unknown;
    isPending: boolean;
    isRefetching: boolean;
  };
  function store<T>(initial: T) {
    let value = initial;
    const listeners = new Set<(next: T) => void>();
    return {
      get: () => value,
      set(next: T) {
        value = next;
        for (const listener of [...listeners]) listener(next);
      },
      listen(listener: (next: T) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }
  const initial: Value = {
    data: null,
    error: null,
    isPending: true,
    isRefetching: false,
  };
  return {
    initial,
    session: store<Value>(initial),
    $sessionSignal: store(false),
  };
});
const { primeCsrfToken } = vi.hoisted(() => ({ primeCsrfToken: vi.fn() }));

vi.mock("@taskdesk/libs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taskdesk/libs")>()),
  primeCsrfToken,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => getSession(...args),
    $store: { atoms },
  },
}));

type BeforeLoad = NonNullable<typeof Route.options.beforeLoad>;

/** Runs the protected layout's check the way the router does, with the app's query client. */
function check(pathname: string): ReturnType<BeforeLoad> {
  const beforeLoad = Route.options.beforeLoad;
  if (!beforeLoad) throw new Error("_authenticated route has no beforeLoad");
  return beforeLoad({
    location: buildRealLocation(pathname, "", ""),
    context: { queryClient },
  } as unknown as Parameters<BeforeLoad>[0]);
}

async function settle(
  pathname: string,
): Promise<{ value: unknown; thrown: unknown }> {
  try {
    return { value: await check(pathname), thrown: undefined };
  } catch (thrown) {
    return { value: undefined, thrown };
  }
}

const redirectTarget = (thrown: unknown) =>
  (thrown as Response & { options: { to: string } }).options.to;

/** One fixed expiry a day ahead, so two sessions built in one test compare equal. */
const SESSION_EXPIRES_AT = new Date(Date.now() + 86_400_000).toISOString();

const signedIn = (sessionId: string, userId = "u1") => ({
  user: { id: userId },
  session: {
    id: sessionId,
    userId,
    expiresAt: SESSION_EXPIRES_AT,
  },
});

const factorResponse = (body: { required: boolean; enabled: boolean }) =>
  new Response(JSON.stringify(body), { status: 200 });

const getSessionCalls = () => getSession.mock.calls.length;
const factorCalls = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).includes("security/factors"))
    .length;

/**
 * Builds a `ParsedLocation` the way TanStack Router's own
 * `Router.parseLocation` actually builds one (see @tanstack/router-core's
 * `router.js` `parse()`): `search` is the *parsed* search object, and
 * `href` is `pathname + searchStr + hash`.
 *
 * Using the router's real `defaultParseSearch`/`defaultStringifySearch`
 * here (rather than a hand-rolled `{ pathname, search: {}, hash }` stub) is
 * what actually reproduces #97: `defaultParseSearch("")` returns an object
 * built with `Object.create(null)` (see router-core's `qss.ts` `decode`),
 * which has no prototype at all. A plain `{}` stub would concatenate into
 * a string just fine and would never have caught this bug.
 */
function buildRealLocation(pathname: string, rawSearch: string, hash: string) {
  const search = defaultParseSearch(rawSearch);
  const searchStr = defaultStringifySearch(search);
  return {
    pathname,
    search,
    searchStr,
    hash,
    href: pathname + searchStr + hash,
    state: {},
  };
}

describe("_authenticated route beforeLoad", () => {
  beforeEach(() => {
    // A fresh client per test: a session cached by one case must not decide another.
    queryClient = new QueryClient();
    atoms.session.set(atoms.initial);
    getSession.mockReset();
    primeCsrfToken.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ required: false, enabled: false }), {
          status: 200,
        }),
      ),
    );
  });

  it("starts the factor freshness read alongside session resolution", async () => {
    let resolveSession!: (value: { data: object; error: null }) => void;
    getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    const beforeLoad = Route.options.beforeLoad;
    if (!beforeLoad) throw new Error("_authenticated route has no beforeLoad");

    const result = beforeLoad({
      location: buildRealLocation("/dashboard/workspace/w1", "", ""),
      context: { queryClient },
    } as unknown as Parameters<typeof beforeLoad>[0]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(primeCsrfToken).not.toHaveBeenCalled();
    resolveSession({ data: {}, error: null });
    await expect(result).resolves.toEqual({ session: {}, sessionError: false });
    // The signed-in shell primes the session CSRF token alongside its first reads.
    expect(primeCsrfToken).toHaveBeenCalledTimes(1);
  });

  it("retries one factor 401 after session resolution before enforcing enrollment", async () => {
    getSession.mockResolvedValue({ data: {}, error: null });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ required: true, enabled: false }), {
          status: 200,
        }),
      );
    const beforeLoad = Route.options.beforeLoad;
    if (!beforeLoad) throw new Error("_authenticated route has no beforeLoad");

    let thrown: unknown;
    try {
      await beforeLoad({
        location: buildRealLocation("/dashboard/workspace/w1", "", ""),
        context: { queryClient },
      } as unknown as Parameters<typeof beforeLoad>[0]);
    } catch (error) {
      thrown = error;
    }

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response & { options: { to: string } }).options.to).toBe(
      "/dashboard/settings/account/security",
    );
  });

  it("fixture reproduces the actual defect: an empty query string parses to a null-prototype object that throws on concatenation", () => {
    const location = buildRealLocation("/dashboard", "", "");

    expect(Object.getPrototypeOf(location.search)).toBeNull();
    // This is the exact throw from #97's repro ("Cannot convert object to
    // primitive value"), reproduced with the router's real parsed search
    // object rather than asserted against a mock.
    expect(
      () => `${location.pathname}${location.search}${location.hash}`,
    ).toThrow(TypeError);
  });

  it("redirects a logged-out user visiting a protected route to sign-in with a well-formed redirect target", async () => {
    getSession.mockResolvedValue({ data: null, error: null });

    const location = buildRealLocation("/dashboard", "", "");
    const beforeLoad = Route.options.beforeLoad;
    if (!beforeLoad) throw new Error("_authenticated route has no beforeLoad");

    let thrown: unknown;
    try {
      await beforeLoad({
        location,
        context: { queryClient },
      } as unknown as Parameters<typeof beforeLoad>[0]);
    } catch (error) {
      thrown = error;
    }

    // Before the fix, `thrown` was a `TypeError` from the concatenation
    // above and the redirect never happened — this is the assertion that
    // catches a regression back to that behavior, not just "it threw
    // something".
    expect(thrown).toBeInstanceOf(Response);
    const redirectOptions = (
      thrown as Response & {
        options: { to: string; search: { redirect: string } };
      }
    ).options;
    expect(redirectOptions.to).toBe("/auth/sign-in");
    expect(redirectOptions.search.redirect).toBe("/dashboard");
  });

  it("also produces a well-formed redirect target when the protected route has a query string and hash", async () => {
    getSession.mockResolvedValue({ data: null, error: null });

    const location = buildRealLocation(
      "/dashboard/workspace/w1",
      "?tab=board",
      "#task-42",
    );
    const beforeLoad = Route.options.beforeLoad;
    if (!beforeLoad) throw new Error("_authenticated route has no beforeLoad");

    let thrown: unknown;
    try {
      await beforeLoad({
        location,
        context: { queryClient },
      } as unknown as Parameters<typeof beforeLoad>[0]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    const redirectOptions = (
      thrown as Response & {
        options: { to: string; search: { redirect: string } };
      }
    ).options;
    expect(redirectOptions.search.redirect).toBe(
      "/dashboard/workspace/w1?tab=board#task-42",
    );
  });

  describe("transient get-session failures (#674)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function run() {
      const beforeLoad = Route.options.beforeLoad;
      if (!beforeLoad) {
        throw new Error("_authenticated route has no beforeLoad");
      }
      const settled: Promise<{ value: unknown; thrown: unknown }> =
        Promise.resolve(
          beforeLoad({
            location: buildRealLocation("/agent/triage", "", ""),
            context: { queryClient },
          } as unknown as Parameters<typeof beforeLoad>[0]),
        ).then(
          (value: unknown) => ({ value, thrown: undefined }),
          (thrown: unknown) => ({ value: undefined, thrown }),
        );
      await vi.runAllTimersAsync();
      return settled;
    }

    it("does not redirect to sign-in on a 429, and recovers when a retry succeeds", async () => {
      vi.useFakeTimers();
      getSession
        .mockResolvedValueOnce({ data: null, error: { status: 429 } })
        .mockResolvedValueOnce({ data: null, error: { status: 429 } })
        .mockResolvedValue({ data: { user: "u1" }, error: null });

      const { value, thrown } = await run();

      expect(thrown).toBeUndefined();
      expect(value).toEqual({
        session: { user: "u1" },
        sessionError: false,
      });
      expect(getSession).toHaveBeenCalledTimes(3);
    });

    it("keeps retrying only a bounded number of times, then shows a transient error instead of redirecting", async () => {
      vi.useFakeTimers();
      getSession.mockResolvedValue({ data: null, error: { status: 429 } });

      const { thrown } = await run();

      expect(thrown).toBeInstanceOf(SessionUnavailableError);
      // Not a sign-in redirect (TanStack redirects are thrown Responses).
      expect(thrown).not.toBeInstanceOf(Response);
      expect(getSession).toHaveBeenCalledTimes(
        SESSION_RETRY_DELAYS_MS.length + 1,
      );
    });

    it("treats a 5xx like a transient failure, not a sign-out", async () => {
      vi.useFakeTimers();
      getSession.mockResolvedValue({ data: null, error: { status: 503 } });

      const { thrown } = await run();

      expect(thrown).toBeInstanceOf(SessionUnavailableError);
    });

    it("still redirects to sign-in on a real 401 without retrying", async () => {
      vi.useFakeTimers();
      getSession.mockResolvedValue({ data: null, error: { status: 401 } });

      const { thrown } = await run();

      expect(thrown).toBeInstanceOf(Response);
      expect(
        (thrown as Response & { options: { to: string } }).options.to,
      ).toBe("/auth/sign-in");
      expect(getSession).toHaveBeenCalledTimes(1);
    });

    it("still redirects to sign-in when the session is null with no error", async () => {
      vi.useFakeTimers();
      getSession.mockResolvedValue({ data: null, error: null });

      const { thrown } = await run();

      expect(thrown).toBeInstanceOf(Response);
      expect(getSession).toHaveBeenCalledTimes(1);
      // A signed-out visitor never asks the agent CSRF issuer.
      expect(primeCsrfToken).not.toHaveBeenCalled();
    });

    it("does not keep a transient answer: the next navigation asks again", async () => {
      vi.useFakeTimers();
      getSession.mockResolvedValue({ data: null, error: { status: 503 } });
      expect((await run()).thrown).toBeInstanceOf(SessionUnavailableError);

      getSession.mockReset();
      getSession.mockResolvedValue({ data: signedIn("s1"), error: null });
      const { thrown } = await run();
      expect(thrown).toBeUndefined();
      expect(getSession).toHaveBeenCalledTimes(1);
    });
  });
});

describe("session kept in the query client (S7b, D9)", () => {
  let stopFollowing: (() => void) | undefined;

  beforeEach(() => {
    queryClient = new QueryClient();
    atoms.session.set(atoms.initial);
    getSession.mockReset();
    primeCsrfToken.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => factorResponse({ required: false, enabled: false })),
    );
  });

  afterEach(() => {
    stopFollowing?.();
    stopFollowing = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads get-session and the factor status once, then not again on later navigations or hover preloads", async () => {
    getSession.mockResolvedValue({ data: signedIn("s1"), error: null });

    await check("/agent/inbox");
    await check("/agent/triage"); // a click
    await check("/agent/views"); // a sidebar hover preload runs the same check
    await check("/agent/my-work");

    expect(getSessionCalls()).toBe(1);
    expect(factorCalls()).toBe(1);
  });

  it("re-reads the session in the background once it is stale, without delaying the navigation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const session = signedIn("s1");
    getSession.mockResolvedValue({ data: session, error: null });
    await check("/agent/inbox");

    vi.setSystemTime(Date.now() + SESSION_STALE_MS + 1);
    let release!: () => void;
    getSession.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ data: session, error: null });
      }),
    );
    // The navigation resolves from the cache while the re-read is still in flight.
    await expect(check("/agent/triage")).resolves.toMatchObject({ session });
    expect(getSessionCalls()).toBe(2);
    const releasedAt = Date.now();
    expect(
      queryClient.getQueryState(["agent-auth", "session"])?.dataUpdatedAt,
    ).toBeLessThan(releasedAt);
    release();
    // The re-read refreshes the cached session.
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryState(["agent-auth", "session"])?.dataUpdatedAt,
      ).toBeGreaterThanOrEqual(releasedAt),
    );
    // Same identity: the factor answer is still kept.
    await check("/agent/views");
    expect(factorCalls()).toBe(1);
  });

  it("re-runs the route checks when a background re-read finds the session revoked, and then redirects to sign-in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const onChanged = vi.fn();
    stopFollowing = followAgentSession(queryClient, onChanged);
    atoms.session.set({
      data: signedIn("s1"),
      error: null,
      isPending: false,
      isRefetching: false,
    });
    await check("/agent/inbox");
    expect(getSessionCalls()).toBe(0);

    vi.setSystemTime(Date.now() + SESSION_STALE_MS + 1);
    getSession.mockResolvedValue({ data: null, error: { status: 401 } });
    await check("/agent/triage");
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    // The router's invalidate re-runs this check, which now has no session to reuse.
    const { thrown } = await settle("/agent/triage");
    expect(redirectTarget(thrown)).toBe("/auth/sign-in");
  });

  it("does not keep an expired session, even within the stale window", async () => {
    const expired = signedIn("s1");
    expired.session.expiresAt = new Date(Date.now() - 1000).toISOString();
    getSession.mockResolvedValueOnce({ data: expired, error: null });
    await check("/agent/inbox");

    getSession.mockResolvedValue({ data: null, error: null });
    const { thrown } = await settle("/agent/triage");
    expect(redirectTarget(thrown)).toBe("/auth/sign-in");
    expect(getSessionCalls()).toBe(2);
  });

  it("asks for the factor status again when the session identity changes", async () => {
    getSession.mockResolvedValue({ data: signedIn("s1"), error: null });
    await check("/agent/inbox");
    expect(factorCalls()).toBe(1);

    // A session signal (sign-in, sign-out, revoke) drops the cached session.
    clearAgentSession(queryClient);
    getSession.mockResolvedValue({ data: signedIn("s2"), error: null });
    await check("/agent/inbox");
    expect(factorCalls()).toBe(2);
    await check("/agent/triage");
    expect(factorCalls()).toBe(2);
  });

  it("redirects to enrolment on every navigation while a required factor is missing, and stops once enrolled", async () => {
    getSession.mockResolvedValue({ data: signedIn("s1"), error: null });
    vi.mocked(fetch).mockImplementation(async () =>
      factorResponse({ required: true, enabled: false }),
    );

    for (const path of ["/agent/inbox", "/agent/triage"]) {
      const { thrown } = await settle(path);
      expect(redirectTarget(thrown)).toBe(
        "/dashboard/settings/account/security",
      );
    }
    expect(factorCalls()).toBe(2);

    // The security page itself is never redirected.
    expect((await settle("/dashboard/settings/account/security")).thrown).toBe(
      undefined,
    );

    vi.mocked(fetch).mockImplementation(async () =>
      factorResponse({ required: true, enabled: true }),
    );
    expect((await settle("/agent/inbox")).thrown).toBeUndefined();
    await check("/agent/triage");
    expect(factorCalls()).toBe(3);
    expect(getSessionCalls()).toBe(1);
  });

  it("does not keep a failed factor read; the next navigation asks again", async () => {
    getSession.mockResolvedValue({ data: signedIn("s1"), error: null });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await check("/agent/inbox");
    await check("/agent/triage");
    expect(factorCalls()).toBe(2);
  });

  describe("a kept factor answer that the API no longer accepts", () => {
    /** Better Auth's store settles signed in, as it does when the page starts. */
    const signInThroughStore = () =>
      atoms.session.set({
        data: signedIn("s1"),
        error: null,
        isPending: false,
        isRefetching: false,
      });

    /** One first-party API call through the real transport, answered with `status` and `body`. */
    async function apiCallAnswered(status: number, body: string) {
      const apiFetch = createApiFetch(
        async () => new Response(body, { status }),
        {
          apiBaseUrl: "http://taskdesk.test/api",
        },
      );
      const response = await apiFetch("http://taskdesk.test/api/v1/task/t1");
      // The caller still reads the refusal itself.
      expect(await response.text()).toBe(body);
    }

    it("drops the kept answer on a 403 mfa_enrollment_required, re-runs the checks, and the next check redirects to enrolment", async () => {
      const onChanged = vi.fn();
      stopFollowing = followAgentSession(queryClient, onChanged);
      signInThroughStore();
      await check("/agent/inbox");
      await check("/agent/triage");
      expect(factorCalls()).toBe(1); // The "passed" answer is kept.

      // An administrator now requires factors (or resets this user's factor) from another
      // device: no session signal reaches this tab, but the API refuses the next call.
      vi.mocked(fetch).mockImplementation(async () =>
        factorResponse({ required: true, enabled: false }),
      );
      await apiCallAnswered(403, "mfa_enrollment_required");
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

      // The router's invalidate re-runs this check, which asks again and leads to enrolment.
      const { thrown } = await settle("/agent/triage");
      expect(redirectTarget(thrown)).toBe(
        "/dashboard/settings/account/security",
      );
      expect(factorCalls()).toBe(2);
      // The session itself is still kept: only the factor answer was dropped.
      expect(getSessionCalls()).toBe(0);
    });

    it("does not re-run the checks again while no answer is kept, so a refused query on the security page cannot loop", async () => {
      const onChanged = vi.fn();
      stopFollowing = followAgentSession(queryClient, onChanged);
      signInThroughStore();
      await check("/agent/inbox");

      await apiCallAnswered(
        403,
        JSON.stringify({ message: "mfa_enrollment_required" }),
      );
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      await apiCallAnswered(403, "mfa_enrollment_required");
      await apiCallAnswered(403, "mfa_enrollment_required");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("ignores other refusals: a step-up, CSRF or permission 403 keeps the factor answer", async () => {
      const onChanged = vi.fn();
      stopFollowing = followAgentSession(queryClient, onChanged);
      signInThroughStore();
      await check("/agent/inbox");

      for (const body of [
        "step_up_required",
        "step_up_expired",
        JSON.stringify({ message: "csrf_token_missing" }),
        "Forbidden",
      ]) {
        await apiCallAnswered(403, body);
      }
      await apiCallAnswered(401, "mfa_enrollment_required");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onChanged).not.toHaveBeenCalled();
      await check("/agent/triage");
      expect(factorCalls()).toBe(1);
    });

    it("stops listening once the follower is stopped", async () => {
      const onChanged = vi.fn();
      followAgentSession(queryClient, onChanged)();
      getSession.mockResolvedValue({ data: signedIn("s1"), error: null });
      await check("/agent/inbox");

      await apiCallAnswered(403, "mfa_enrollment_required");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe("Better Auth's session store", () => {
    it("seeds the cache, so the first route check sends no second get-session", async () => {
      stopFollowing = followAgentSession(queryClient, vi.fn());
      atoms.session.set({
        data: signedIn("s1"),
        error: null,
        isPending: false,
        isRefetching: false,
      });

      await check("/agent/inbox");
      expect(getSessionCalls()).toBe(0);
    });

    it("lets a route check made during the store's first read wait for it instead of reading again", async () => {
      stopFollowing = followAgentSession(queryClient, vi.fn());
      atoms.session.set({ ...atoms.initial, isRefetching: true });

      const result = check("/agent/projects/HELP/work");
      atoms.session.set({
        data: signedIn("s1"),
        error: null,
        isPending: false,
        isRefetching: false,
      });

      await expect(result).resolves.toMatchObject({ session: signedIn("s1") });
      expect(getSessionCalls()).toBe(0);
    });

    it("falls back to its own bounded read when the store's first read fails transiently", async () => {
      stopFollowing = followAgentSession(queryClient, vi.fn());
      getSession.mockResolvedValue({ data: signedIn("s1"), error: null });

      const result = check("/agent/inbox");
      atoms.session.set({
        data: null,
        error: { status: 503 },
        isPending: false,
        isRefetching: false,
      });

      await expect(result).resolves.toMatchObject({ session: signedIn("s1") });
      expect(getSessionCalls()).toBe(1);
    });

    it("clears the cache and re-runs the checks when the store loses the session (sign-out, another tab, revoke)", async () => {
      const onChanged = vi.fn();
      stopFollowing = followAgentSession(queryClient, onChanged);
      atoms.session.set({
        data: signedIn("s1"),
        error: null,
        isPending: false,
        isRefetching: false,
      });
      await check("/agent/inbox");

      atoms.session.set({
        data: null,
        error: { status: 401 },
        isPending: false,
        isRefetching: false,
      });
      expect(onChanged).toHaveBeenCalledTimes(1);

      getSession.mockResolvedValue({ data: null, error: null });
      const { thrown } = await settle("/agent/triage");
      expect(redirectTarget(thrown)).toBe("/auth/sign-in");
    });

    it("re-runs the checks and asks for factors again when the store reports a different identity", async () => {
      const onChanged = vi.fn();
      stopFollowing = followAgentSession(queryClient, onChanged);
      const settled = (id: string, userId?: string) =>
        atoms.session.set({
          data: signedIn(id, userId),
          error: null,
          isPending: false,
          isRefetching: false,
        });
      settled("s1");
      await check("/agent/inbox");
      expect(factorCalls()).toBe(1);

      settled("s9", "u2");
      expect(onChanged).toHaveBeenCalledTimes(1);
      await check("/agent/inbox");
      expect(factorCalls()).toBe(2);
      expect(getSessionCalls()).toBe(0);
    });

    it("drops the cached session and factor answer on any session signal; the next check reads them again", async () => {
      stopFollowing = followAgentSession(queryClient, vi.fn());
      atoms.session.set({
        data: signedIn("s1"),
        error: null,
        isPending: false,
        isRefetching: false,
      });
      await check("/agent/inbox");
      expect(getSessionCalls()).toBe(0);

      getSession.mockResolvedValue({ data: signedIn("s1"), error: null });
      atoms.$sessionSignal.set(!atoms.$sessionSignal.get());
      await check("/agent/triage");
      expect(getSessionCalls()).toBe(1);
      // The signal also fires on factor enrolment and password changes, so the factor
      // answer is asked again too.
      expect(factorCalls()).toBe(2);
    });

    it("keeps the session through a transient store failure", async () => {
      const onChanged = vi.fn();
      stopFollowing = followAgentSession(queryClient, onChanged);
      atoms.session.set({
        data: signedIn("s1"),
        error: null,
        isPending: false,
        isRefetching: false,
      });
      // Better Auth keeps the last session on a 5xx or network failure.
      atoms.session.set({
        data: signedIn("s1"),
        error: { status: 503 },
        isPending: false,
        isRefetching: false,
      });
      expect(onChanged).not.toHaveBeenCalled();
      await check("/agent/inbox");
      expect(getSessionCalls()).toBe(0);
    });
  });
});
