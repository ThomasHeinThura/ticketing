/**
 * A hover read of a work item started in one workspace must not satisfy a later open after the
 * person switched workspace. Driven through the real Better Auth store, the real
 * `followAgentSession` and the real workspace activation call.
 */
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@taskdesk/libs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taskdesk/libs")>()),
  primeCsrfToken: vi.fn(),
}));
const getWorkItem = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/work-item/get-work-item", () => ({
  default: (key: string) => getWorkItem(key),
}));

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const session = {
  user: { id: "u1", email: "agent@example.test", name: "Agent" },
  session: {
    id: "s1",
    userId: "u1",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  },
};
const fetchStub = vi.fn(async (input: unknown) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;
  if (url.includes("/api/auth/get-session")) return json(session);
  if (url.includes("/me/csrf-token"))
    return json({
      token: "test-token",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  if (url.includes("/activate")) return json({ id: "w2" });
  return new Response(null, { status: 404 });
});

describe("work item detail reads follow the active workspace", () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchStub);
  });
  afterEach(() => {
    stop?.();
    vi.unstubAllGlobals();
  });

  it("drops a read in flight when the workspace is switched, so opening the item asks again", async () => {
    const { followAgentSession } = await import("./agent-session");
    const { authClient } = await import("./auth-client");
    const { default: activateWorkspace } = await import(
      "@/fetchers/workspace/activate-workspace"
    );
    const { prefetchWorkItemDetail, workItemDetailQueryKey } = await import(
      "@/hooks/queries/work-item/use-get-work-item"
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnMount: false } },
    });
    stop = followAgentSession(queryClient, vi.fn());
    await vi.waitFor(() =>
      expect(authClient.$store.atoms.session.get().data).toBeTruthy(),
    );

    let finish: (value: unknown) => void = () => {};
    getWorkItem.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    prefetchWorkItemDetail(queryClient, "HELP-1");
    expect(getWorkItem).toHaveBeenCalledTimes(1);

    // The real switch: the activation call, then the store's own signal.
    await activateWorkspace("w2");

    finish({ key: "HELP-1", title: "Workspace one's item" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      queryClient.getQueryData(workItemDetailQueryKey("HELP-1")),
    ).toBeUndefined();

    getWorkItem.mockRejectedValueOnce(new Error("forbidden"));
    prefetchWorkItemDetail(queryClient, "HELP-1");
    expect(getWorkItem).toHaveBeenCalledTimes(2);
  });
});
