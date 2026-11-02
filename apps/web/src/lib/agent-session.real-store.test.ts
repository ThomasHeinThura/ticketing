/**
 * S7b against the real Better Auth client and its nanostores session store, not a stand-in:
 * the store seeds the route check's session, a cold route check waits for the store's first
 * read instead of sending a second `get-session`, and a sign-out ends the cached session.
 */
import { QueryClient } from "@tanstack/react-query";
import {
  defaultParseSearch,
  defaultStringifySearch,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@taskdesk/libs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taskdesk/libs")>()),
  primeCsrfToken: vi.fn(),
}));

const server = {
  signedIn: true,
  session: {
    user: { id: "u1", email: "agent@example.test", name: "Agent" },
    session: {
      id: "s1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

const fetchStub = vi.fn(async (input: unknown) => {
  const url = urlOf(input);
  if (url.includes("/api/auth/get-session"))
    return json(server.signedIn ? server.session : null);
  if (url.includes("/api/auth/sign-out")) {
    server.signedIn = false;
    return json({ success: true });
  }
  if (url.includes("me/security/factors"))
    return json({ required: false, enabled: false });
  return new Response(null, { status: 404 });
});

const calls = (path: string) =>
  fetchStub.mock.calls.filter(([input]) => urlOf(input).includes(path)).length;

function location(pathname: string) {
  const search = defaultParseSearch("");
  const searchStr = defaultStringifySearch(search);
  return { pathname, search, searchStr, hash: "", href: pathname, state: {} };
}

describe("agent session with the real Better Auth store (S7b)", () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    fetchStub.mockClear();
    server.signedIn = true;
    // Better Auth captures `fetch` when the client is created, so stub it before importing.
    vi.stubGlobal("fetch", fetchStub);
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.unstubAllGlobals();
  });

  it("sends one get-session on a cold load and none on later navigations; a sign-out re-runs the checks, which then redirect", async () => {
    const { followAgentSession } = await import("./agent-session");
    const { authClient } = await import("./auth-client");
    const { Route } = await import("@/routes/agent/_layout/_authenticated");
    const beforeLoad = Route.options.beforeLoad;
    if (!beforeLoad) throw new Error("_authenticated route has no beforeLoad");
    const queryClient = new QueryClient();
    const check = (pathname: string) =>
      beforeLoad({
        location: location(pathname),
        context: { queryClient },
      } as unknown as Parameters<typeof beforeLoad>[0]);

    const onChanged = vi.fn();
    stop = followAgentSession(queryClient, onChanged);
    // The work-list preload runs this check while the store's first read is in flight.
    await expect(check("/agent/projects/HELP/work")).resolves.toMatchObject({
      session: { session: { id: "s1" }, user: { id: "u1" } },
    });
    await check("/agent/inbox");
    await check("/agent/triage");
    expect(calls("/api/auth/get-session")).toBe(1);
    expect(calls("me/security/factors")).toBe(1);
    expect(onChanged).not.toHaveBeenCalled();

    await authClient.signOut();
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    let thrown: unknown;
    try {
      await check("/agent/triage");
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { options?: { to?: string } }).options?.to).toBe(
      "/auth/sign-in",
    );
    // Importing the real route module afresh is slow on a loaded runner.
  }, 30_000);
});
