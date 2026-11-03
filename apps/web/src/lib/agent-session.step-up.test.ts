import { QueryClient } from "@tanstack/react-query";
import {
  defaultParseSearch,
  defaultStringifySearch,
} from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S7b step-up evidence: the session and the factor answer kept in the query client decide only
 * when the shell re-reads them. A sensitive action still needs its own fresh step-up proof, and
 * the API's step-up refusal reaches the caller, after navigations served from that cache.
 *
 * The real transport (`@taskdesk/libs` `apiFetch`/`client`) captures `fetch` when it loads, so a
 * routing stub is installed before any import and every request goes through `transport`.
 */
const { transport } = vi.hoisted(() => {
  const transport = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    transport(new Request(input, init)),
  );
  return { transport };
});

const getSession = vi.fn();

const atoms = vi.hoisted(() => {
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
  return {
    session: store({
      data: null as unknown,
      error: null as unknown,
      isPending: false,
      isRefetching: false,
    }),
    $sessionSignal: store(false),
  };
});

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => getSession(...args),
    $store: { atoms },
  },
}));

import { IdentityAdminError } from "@/fetchers/god-mode/identity-admin-error";
import { proveIdentityOperation } from "@/fetchers/god-mode/identity-step-up";
import { createServiceKey } from "@/fetchers/service-keys";
import { HttpError } from "@/lib/http-error";
import { Route } from "@/routes/agent/_layout/_authenticated";
import {
  factorsPassed,
  followAgentSession,
  peekAgentSession,
} from "./agent-session";

const STEP_UP_HEADER = "x-taskdesk-step-up-token";
const sessionExpiresAt = new Date(Date.now() + 86_400_000).toISOString();
const signedIn = {
  user: { id: "u1" },
  session: { id: "s1", userId: "u1", expiresAt: sessionExpiresAt },
};

let queryClient = new QueryClient();
/** What the API answers for each sensitive call in the current test. */
let answers: {
  createKey: () => Response;
  challenge: () => Response;
  proof: () => Response;
};

function check(pathname: string) {
  const beforeLoad = Route.options.beforeLoad;
  if (!beforeLoad) throw new Error("_authenticated route has no beforeLoad");
  const search = defaultParseSearch("");
  const searchStr = defaultStringifySearch(search);
  return beforeLoad({
    location: {
      pathname,
      search,
      searchStr,
      hash: "",
      href: pathname,
      state: {},
    },
    context: { queryClient },
  } as unknown as Parameters<typeof beforeLoad>[0]);
}

const requestsTo = (fragment: string) =>
  transport.mock.calls
    .map(([request]) => request)
    .filter((request) => new URL(request.url).pathname.endsWith(fragment));

/** Three navigations; afterwards the session and the factor answer are served from the cache. */
async function navigateFromCache() {
  await check("/agent/inbox");
  await check("/agent/triage");
  await check("/dashboard/workspace/ws-1/settings/service-keys");
  expect(getSession).toHaveBeenCalledTimes(1);
  expect(requestsTo("/me/security/factors")).toHaveLength(1);
  expect(factorsPassed(queryClient, peekAgentSession(queryClient))).toBe(true);
  transport.mockClear();
  getSession.mockClear();
}

/** Nothing about the session or factors was read, and the kept answers are unchanged. */
function expectCacheUntouched() {
  expect(getSession).not.toHaveBeenCalled();
  expect(requestsTo("/me/security/factors")).toHaveLength(0);
  expect(factorsPassed(queryClient, peekAgentSession(queryClient))).toBe(true);
}

describe("step-up after cached navigations (S7b)", () => {
  let stopFollowing: () => void = () => {};

  beforeEach(() => {
    stopFollowing();
    queryClient = new QueryClient();
    getSession.mockReset().mockResolvedValue({ data: signedIn, error: null });
    answers = {
      createKey: () => new Response("step_up_expired", { status: 403 }),
      challenge: () =>
        Response.json({ challengeId: "challenge-1", nonce: "n".repeat(43) }),
      proof: () => new Response("step_up_proof_failure", { status: 403 }),
    };
    transport.mockReset().mockImplementation(async (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/me/security/factors"))
        return Response.json({ required: true, enabled: true });
      if (path.endsWith("/me/csrf-token"))
        return Response.json({
          token: "csrf-token",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
      if (path.endsWith("/workspaces/ws-1/api-keys"))
        return answers.createKey();
      if (path.endsWith("/me/step-up/challenges")) return answers.challenge();
      if (path.endsWith("/me/step-up")) return answers.proof();
      return new Response("unexpected", { status: 599 });
    });
    stopFollowing = followAgentSession(queryClient, vi.fn());
  });

  it("an elevated write sends only the proof it was given, and an expired proof is refused to the caller", async () => {
    await navigateFromCache();

    const write = createServiceKey(
      "ws-1",
      { name: "Pipeline", expiresIn: null, capabilities: ["workspace:read"] },
      "expired-proof",
    );
    await expect(write).rejects.toBeInstanceOf(HttpError);
    await expect(write).rejects.toMatchObject({
      status: 403,
      message: "step_up_expired",
    });
    const [sent] = requestsTo("/workspaces/ws-1/api-keys");
    expect(sent?.headers.get(STEP_UP_HEADER)).toBe("expired-proof");
    // A step-up refusal is not a factor-enrolment refusal: the shell keeps its answers and
    // does not re-read the session to "satisfy" the action.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expectCacheUntouched();
  });

  it("an elevated write without a proof sends none and is refused with step_up_required", async () => {
    await navigateFromCache();
    answers.createKey = () => new Response("step_up_required", { status: 403 });

    await expect(
      createServiceKey(
        "ws-1",
        { name: "Pipeline", expiresIn: null, capabilities: ["workspace:read"] },
        "",
      ),
    ).rejects.toMatchObject({ status: 403, message: "step_up_required" });
    const [sent] = requestsTo("/workspaces/ws-1/api-keys");
    expect(sent?.headers.get(STEP_UP_HEADER) ?? "").toBe("");
    expectCacheUntouched();
  });

  it("each step-up asks the API for a fresh challenge and a refused proof surfaces as a step-up failure", async () => {
    await navigateFromCache();
    const binding = {
      operation: "service_key_create" as const,
      workspaceId: "ws-1",
      name: "Pipeline",
      capabilities: ["workspace:read"],
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      const proof = proveIdentityOperation(binding, {
        method: "password",
        secret: "wrong",
      });
      await expect(proof).rejects.toBeInstanceOf(IdentityAdminError);
      await expect(proof).rejects.toMatchObject({ kind: "step_up" });
      expect(requestsTo("/me/step-up/challenges")).toHaveLength(attempt);
      expect(requestsTo("/me/step-up")).toHaveLength(attempt);
    }
    expectCacheUntouched();
  });
});
