/**
 * PTM-01: an identity change seen on the shell (a background cookie or session change in the same
 * tab) must not leave the previous staff member's protected reads in the query cache. Driven
 * through the real Better Auth store, the real `followAgentSession` and a real `QueryObserver`
 * on a project the first user can read and the second cannot. The API's own refusal is unchanged;
 * this only checks what the shell renders before and after that refusal.
 */
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@taskdesk/libs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taskdesk/libs")>()),
  primeCsrfToken: vi.fn(),
}));

const expiresAt = () => new Date(Date.now() + 86_400_000).toISOString();
const sessionOf = (userId: string, sessionId: string) => ({
  user: { id: userId, email: `${userId}@example.test`, name: userId },
  session: { id: sessionId, userId, expiresAt: expiresAt() },
});

const server = {
  session: sessionOf("userA", "sessionA") as ReturnType<
    typeof sessionOf
  > | null,
  sessionStatus: 200,
  sessionGate: null as Promise<void> | null,
  // Holds exactly the next raw get-session, answered with the cookie as it was when it was sent.
  heldSessionRead: null as Promise<void> | null,
  projectGate: null as Promise<void> | null,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

// The cookie decides the answer, exactly as the API does: only userA may read the project.
const fetchStub = vi.fn(async (input: unknown) => {
  const url = urlOf(input);
  if (url.includes("/api/auth/get-session")) {
    const sentWith = server.session;
    const held = server.heldSessionRead;
    server.heldSessionRead = null;
    await held;
    await server.sessionGate;
    if (server.sessionStatus !== 200)
      return new Response(null, { status: server.sessionStatus });
    return json(held ? sentWith : server.session);
  }
  if (url.includes("/api/project/a-only")) {
    const reader = server.session?.user.id;
    await server.projectGate;
    return reader === "userA"
      ? json({ id: "a-only", name: "A-only secret project" })
      : json({ message: "forbidden" }, 403);
  }
  return new Response(null, { status: 404 });
});

type Project = { id: string; name: string };
const projectKey = ["projects", "w1", "a-only"] as const;

async function readProject(): Promise<Project> {
  const response = await fetch("/api/project/a-only");
  if (!response.ok) throw Object.assign(new Error("denied"), { status: 403 });
  return (await response.json()) as Project;
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("agent identity transition clears protected cached reads (PTM-01)", () => {
  let stop: (() => void) | undefined;
  let queryClient: QueryClient;
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    fetchStub.mockClear();
    server.session = sessionOf("userA", "sessionA");
    server.sessionStatus = 200;
    server.sessionGate = null;
    server.heldSessionRead = null;
    server.projectGate = null;
    vi.stubGlobal("fetch", fetchStub);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnMount: false },
      },
    });
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    stop?.();
    stop = undefined;
    vi.unstubAllGlobals();
  });

  async function startAsUserA() {
    const { followAgentSession } = await import("./agent-session");
    const { authClient } = await import("./auth-client");
    const onChanged = vi.fn();
    stop = followAgentSession(queryClient, onChanged);
    // The shell is following user A once the store has answered.
    await vi.waitFor(() =>
      expect(authClient.$store.atoms.session.get().data).toBeTruthy(),
    );
    const observer = new QueryObserver<Project>(queryClient, {
      queryKey: projectKey,
      queryFn: readProject,
    });
    // An active screen: the observer stays subscribed across the whole transition.
    unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data?.name).toBe(
        "A-only secret project",
      ),
    );
    return { observer, onChanged, authClient };
  }

  const switchTo = async (
    authClient: { $store: { notify: (signal: string) => void } },
    userId: string,
    sessionId: string,
  ) => {
    server.session = sessionOf(userId, sessionId);
    authClient.$store.notify("$sessionSignal");
  };

  it("never shows user A's project to user B, and B's own denied read replaces it", async () => {
    const { observer, onChanged, authClient } = await startAsUserA();

    await switchTo(authClient, "userB", "sessionB");
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    // Immediately after the verified identity change, nothing of A is rendered.
    expect(observer.getCurrentResult().data).toBeUndefined();
    // B's read is a fresh, definitive 403, never A's cached project.
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().status).toBe("error"),
    );
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(queryClient.getQueryData(projectKey)).toBeUndefined();
  });

  it("does not let a request user A started before the change resurrect A's data", async () => {
    const { observer, onChanged, authClient } = await startAsUserA();
    // A re-read is in flight when the identity changes.
    const gate = deferred();
    server.projectGate = gate.promise;
    void observer.refetch();
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isFetching).toBe(true),
    );

    await switchTo(authClient, "userB", "sessionB");
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(observer.getCurrentResult().data).toBeUndefined();

    // The old A response lands late, after the transition.
    server.projectGate = null;
    gate.release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(queryClient.getQueryData(projectKey)).toBeUndefined();
  });

  it("keeps the cached read while user B's session answer is still pending or transient", async () => {
    const { observer, authClient } = await startAsUserA();
    const gate = deferred();
    server.sessionGate = gate.promise;
    // A background re-read is slow: the identity is not verified yet, so nothing is dropped.
    await switchTo(authClient, "userB", "sessionB");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(observer.getCurrentResult().data?.name).toBe(
      "A-only secret project",
    );

    // A transient failure says nothing about who is signed in.
    server.sessionGate = null;
    server.sessionStatus = 503;
    gate.release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(observer.getCurrentResult().data?.name).toBe(
      "A-only secret project",
    );
  });

  it("keeps the cached read for the same user on a new session (normal refresh)", async () => {
    const { observer, onChanged, authClient } = await startAsUserA();
    await switchTo(authClient, "userA", "sessionA2");
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(observer.getCurrentResult().data?.name).toBe(
      "A-only secret project",
    );
  });

  it("drops the read when the session ends, so a later different sign-in cannot see it", async () => {
    const { observer, onChanged, authClient } = await startAsUserA();
    server.session = null;
    authClient.$store.notify("$sessionSignal");
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(observer.getCurrentResult().data).toBeUndefined();

    // A different person signs in on this tab afterwards.
    await switchTo(authClient, "userB", "sessionB");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queryClient.getQueryData(projectKey)).toBeUndefined();
    expect(observer.getCurrentResult().data).toBeUndefined();
  });

  // Round 2 (Sol High round 1): a raw `get-session` the shell itself sent before the store
  // accepted the new identity must not bring the old identity back, neither into the cache nor
  // to the route check that is waiting for it.
  describe("a late raw session read after the store accepted the next identity", () => {
    async function withHeldRawRead(
      sentAs: ReturnType<typeof sessionOf> | null,
    ) {
      const started = await startAsUserA();
      const { resolveAgentSession, clearAgentSession, agentSessionKeys } =
        await import("./agent-session");
      // The route check finds no cached session and sends its own raw read, held in flight.
      const held = deferred();
      server.session = sentAs;
      server.heldSessionRead = held.promise;
      clearAgentSession(queryClient);
      const pending = resolveAgentSession(queryClient);
      await vi.waitFor(() => expect(server.heldSessionRead).toBeNull());
      return {
        ...started,
        held,
        pending,
        resolveAgentSession,
        clearAgentSession,
        agentSessionKeys,
      };
    }

    it("returns and keeps user B when user A's old answer lands after B", async () => {
      const { held, pending, authClient, onChanged, agentSessionKeys } =
        await withHeldRawRead(sessionOf("userA", "sessionA"));
      await switchTo(authClient, "userB", "sessionB");
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
      held.release();
      await expect(pending).resolves.toMatchObject({
        kind: "resolved",
        session: { user: { id: "userB" } },
      });
      expect(
        queryClient.getQueryData<{ user: { id: string } }>(
          agentSessionKeys.session(),
        )?.user.id,
      ).toBe("userB");
    });

    it("returns user B, not a signed-out answer, when a late null lands after B", async () => {
      const { held, pending, authClient, onChanged, agentSessionKeys } =
        await withHeldRawRead(null);
      await switchTo(authClient, "userB", "sessionB");
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
      held.release();
      await expect(pending).resolves.toMatchObject({
        kind: "resolved",
        session: { user: { id: "userB" } },
      });
      expect(
        queryClient.getQueryData<{ user: { id: string } }>(
          agentSessionKeys.session(),
        )?.user.id,
      ).toBe("userB");
    });

    it("does not roll a rotated session of the same user back to the old session", async () => {
      const {
        held,
        pending,
        observer,
        authClient,
        onChanged,
        agentSessionKeys,
      } = await withHeldRawRead(sessionOf("userA", "sessionA"));
      await switchTo(authClient, "userA", "sessionA2");
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
      held.release();
      await expect(pending).resolves.toMatchObject({
        session: { session: { id: "sessionA2" } },
      });
      expect(
        queryClient.getQueryData<{ session: { id: string } }>(
          agentSessionKeys.session(),
        )?.session.id,
      ).toBe("sessionA2");
      // The same person keeps their reads.
      expect(observer.getCurrentResult().data?.name).toBe(
        "A-only secret project",
      );
    });

    it("lets a fresh check read the new identity while the old read is still hung", async () => {
      const {
        held,
        pending,
        authClient,
        onChanged,
        resolveAgentSession,
        clearAgentSession,
      } = await withHeldRawRead(sessionOf("userA", "sessionA"));
      await switchTo(authClient, "userB", "sessionB");
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
      // No cached session, the stale read has not answered: a new check must not wait for it.
      clearAgentSession(queryClient);
      await expect(resolveAgentSession(queryClient)).resolves.toMatchObject({
        session: { user: { id: "userB" } },
      });
      held.release();
      await expect(pending).resolves.toMatchObject({
        session: { user: { id: "userB" } },
      });
    });
  });
});
