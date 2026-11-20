import {
  onlineManager,
  type QueryClient,
  QueryClientProvider,
  MutationObserver as TanstackMutationObserver,
} from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { createQueryClient } from "@/query-client";
import type { HistoryTarget } from "@/query-client/settings-history-key";
import { useSettingsHistory } from "./use-settings-history";

const read = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({
  user: "u1",
  id: "s1",
  check: vi.fn(),
}));
vi.mock("@/fetchers/settings/settings-history", () => ({
  getSettingsHistory: read,
}));
vi.mock("@/fetchers/time-tracking", () => ({ getTimeSettings: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: session.user }, session: { id: session.id } },
    }),
    getSession: () => session.check(),
  },
}));

const workspace = (id: string): HistoryTarget => ({
  kind: "entity",
  type: "workspace",
  id,
  scope: { kind: "workspace", workspaceId: id },
});
const view = (id: string, count = 1) => ({
  entityType: "workspace",
  entityId: id,
  workspaceId: id,
  projectId: null,
  lastChanged: null,
  rows: Array.from({ length: count }, () => ({
    at: "2026-01-01T00:00:00Z",
    actor: { kind: "person", name: "A" },
    action: "workspace.settings_updated",
    changedFields: [],
  })),
});
const sessionOk = () => ({
  data: { user: { id: session.user }, session: { id: session.id } },
  error: null,
});
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}

function Probe({ target, name }: { target: HistoryTarget; name: string }) {
  const { state, revalidate } = useSettingsHistory(target);
  return (
    <>
      <p data-testid={name}>
        {state.status === "ready"
          ? `ready:${state.data.rows.length}`
          : state.status}
      </p>
      <Button type="button" onClick={revalidate}>
        {name}-retry
      </Button>
    </>
  );
}

// The real production client (refetchOnMount: false) with only the retry backoff removed.
function productionClient() {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retry: false },
  });
  return client;
}
function mountProbe(
  client: QueryClient,
  target: HistoryTarget = workspace("w1"),
) {
  return render(
    <QueryClientProvider client={client}>
      <Probe target={target} name="p" />
    </QueryClientProvider>,
  );
}
const status = () => screen.getByTestId("p").textContent;
const save = (
  client: QueryClient,
  targets: (
    variables: { id: string },
    result: { id: string },
  ) => HistoryTarget[],
  variables = { id: "w1" },
) => {
  const mutation = new TanstackMutationObserver(client, {
    mutationFn: async (input: { id: string }) => ({ id: input.id }),
    meta: { audits: { targets } },
  });
  return act(() => mutation.mutate(variables));
};

beforeEach(() => {
  read.mockReset();
  session.user = "u1";
  session.id = "s1";
  session.check.mockReset().mockImplementation(async () => sessionOk());
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe("class 1: rows never outlive the reach that admitted them", () => {
  it("hides loaded rows when another query is refused and the reread is refused", async () => {
    const client = productionClient();
    read.mockResolvedValue(view("w1"));
    mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
    read.mockRejectedValue(new HttpError(403, "Forbidden"));
    await act(async () => {
      await client
        .fetchQuery({
          queryKey: ["parent"],
          queryFn: () => Promise.reject(new HttpError(403, "Forbidden")),
        })
        .catch(() => {});
    });
    await waitFor(() => expect(status()).toBe("hidden"));
  });

  it("cannot be restored by an older response that arrives late", async () => {
    const client = productionClient();
    read.mockResolvedValueOnce(view("w1"));
    mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
    const late = deferred<unknown>();
    read.mockReturnValueOnce(late.promise);
    act(() => screen.getByText("p-retry").click());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(status()).toBe("checking");
    read.mockRejectedValue(new HttpError(404, "Gone"));
    await act(async () => {
      await client
        .fetchQuery({
          queryKey: ["parent"],
          queryFn: () => Promise.reject(new HttpError(404, "Gone")),
        })
        .catch(() => {});
    });
    await waitFor(() => expect(status()).toBe("hidden"));
    await act(async () => late.resolve(view("w1", 5)));
    expect(status()).toBe("hidden");
  });

  it("hides when the session is a different person", async () => {
    const client = productionClient();
    read.mockResolvedValue(view("w1"));
    session.check.mockImplementation(async () => ({
      data: { user: { id: "u2" }, session: { id: "s9" } },
      error: null,
    }));
    mountProbe(client);
    await waitFor(() => expect(status()).toBe("hidden"));
  });
});

describe("class 2: a committed save never leaves old metadata on screen", () => {
  it("shows a Retry while the session check fails, then the fresh rows", async () => {
    const client = productionClient();
    read.mockResolvedValueOnce(view("w1", 1));
    mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
    session.check.mockRejectedValue(new TypeError("Failed to fetch"));
    await save(client, (_v, result) => [workspace(result.id)]);
    await waitFor(() => expect(status()).toBe("error"));
    session.check.mockImplementation(async () => sessionOk());
    read.mockResolvedValue(view("w1", 2));
    act(() => screen.getByText("p-retry").click());
    await waitFor(() => expect(status()).toBe("ready:2"));
  });

  it("withholds metadata while the check stalls", async () => {
    const client = productionClient();
    read.mockResolvedValue(view("w1", 1));
    mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
    session.check.mockReturnValue(new Promise(() => {}));
    await save(client, () => [workspace("w1")]);
    await waitFor(() => expect(status()).toBe("checking"));
  });

  it("does not reveal old rows when the save cancels a disclosure read", async () => {
    const client = productionClient();
    read.mockResolvedValueOnce(view("w1", 1));
    mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
    const oldRead = deferred<unknown>();
    read.mockReturnValueOnce(oldRead.promise);
    act(() => screen.getByText("p-retry").click());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    read.mockResolvedValue(view("w1", 3));
    await save(client, () => [workspace("w1")]);
    await waitFor(() => expect(status()).toBe("ready:3"));
    await act(async () => oldRead.resolve(view("w1", 1)));
    expect(status()).toBe("ready:3");
  });
});

describe("cancellation rollback", () => {
  it("never shows the older rows a cancelled read rolls back to", async () => {
    const client = productionClient();
    read.mockResolvedValueOnce(view("w1", 1));
    mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
    read.mockReturnValueOnce(new Promise(() => {}));
    act(() => screen.getByText("p-retry").click());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await act(async () => {
      await client.cancelQueries();
    });
    await waitFor(() => expect(status()).toBe("error"));
    read.mockResolvedValue(view("w1", 2));
    act(() => screen.getByText("p-retry").click());
    await waitFor(() => expect(status()).toBe("ready:2"));
  });
});

describe("class 3: refusal hides, failure offers Retry", () => {
  it.each([403, 404])("hides on %s", async (code) => {
    read.mockRejectedValue(new HttpError(code, "refused"));
    mountProbe(productionClient());
    await waitFor(() => expect(status()).toBe("hidden"));
  });

  it.each([500, 429, 408])("offers Retry on %s and recovers", async (code) => {
    read.mockRejectedValueOnce(new HttpError(code, "down"));
    mountProbe(productionClient());
    await waitFor(() => expect(status()).toBe("error"));
    read.mockResolvedValue(view("w1"));
    act(() => screen.getByText("p-retry").click());
    await waitFor(() => expect(status()).toBe("ready:1"));
  });

  it("offers Retry offline instead of waiting forever", async () => {
    onlineManager.setOnline(false);
    read.mockRejectedValue(new TypeError("Failed to fetch"));
    mountProbe(productionClient());
    await waitFor(() => expect(status()).toBe("error"));
  });

  it("treats a malformed or failed guard check as Retry, not hidden", async () => {
    session.check.mockRejectedValue(new TypeError("Failed to fetch"));
    mountProbe(productionClient());
    await waitFor(() => expect(status()).toBe("error"));
    expect(read).not.toHaveBeenCalled();
  });
});

describe("class 4: a remount is guarded by a fresh read", () => {
  it("never replays cached success while the new read is held", async () => {
    const client = productionClient();
    read.mockResolvedValueOnce(view("w1", 1));
    const first = mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
    first.unmount();
    const held = deferred<unknown>();
    read.mockReturnValueOnce(held.promise);
    mountProbe(client);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(status()).toBe("checking");
    await act(async () => held.resolve(view("w1", 2)));
    await waitFor(() => expect(status()).toBe("ready:2"));
  });

  it("rereads after a cached denial instead of staying hidden", async () => {
    const client = productionClient();
    read.mockRejectedValueOnce(new HttpError(403, "refused"));
    const first = mountProbe(client);
    await waitFor(() => expect(status()).toBe("hidden"));
    first.unmount();
    read.mockResolvedValue(view("w1", 1));
    mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
  });

  it("does not show another target or person from the cache", async () => {
    const client = productionClient();
    read.mockResolvedValue(view("w1", 1));
    const first = mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
    first.unmount();
    session.user = "u2";
    session.id = "s2";
    const held = deferred<unknown>();
    read.mockReturnValueOnce(held.promise);
    mountProbe(client);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(status()).toBe("checking");
  });

  it("partitions one terminology cell by instance and workspace scope", async () => {
    const client = productionClient();
    read.mockImplementation(async (_type, id, _signal, selector) => ({
      ...view(id, selector?.scope === "workspace" ? 2 : 1),
      workspaceId:
        selector?.scope === "workspace" ? selector.workspaceId : null,
    }));
    const terminology = (scope: "instance" | "workspace"): HistoryTarget => ({
      kind: "entity",
      type: "terminology_override",
      id: "request:both:en-US",
      scope:
        scope === "instance"
          ? { kind: "instance" }
          : { kind: "workspace", workspaceId: "w1" },
    });
    render(
      <QueryClientProvider client={client}>
        <Probe target={terminology("instance")} name="i" />
        <Probe target={terminology("workspace")} name="w" />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("i").textContent).toBe("ready:1");
      expect(screen.getByTestId("w").textContent).toBe("ready:2");
    });
  });
});

describe("class 6: the global MutationCache withdraws what the mutation declares", () => {
  it("rereads only the declared target, resolved from the result (a new id)", async () => {
    const client = productionClient();
    read.mockImplementation(async (_type, id) => view(id, 1));
    render(
      <QueryClientProvider client={client}>
        <Probe target={workspace("w1")} name="a" />
        <Probe target={workspace("w2")} name="b" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId("b").textContent).toBe("ready:1"),
    );
    read.mockImplementation(async (_type, id) => view(id, id === "w2" ? 4 : 1));
    await save(client, (_v, result) => [workspace(result.id)], { id: "w2" });
    await waitFor(() =>
      expect(screen.getByTestId("b").textContent).toBe("ready:4"),
    );
    expect(read).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("a").textContent).toBe("ready:1");
  });

  it("withdraws before the screen's own onSuccess runs", async () => {
    const client = productionClient();
    read.mockResolvedValue(view("w1", 1));
    mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
    let seen = "";
    const mutation = new TanstackMutationObserver(client, {
      mutationFn: async () => ({ id: "w1" }),
      meta: { audits: { targets: () => [workspace("w1")] } },
      onSuccess: () => {
        seen = status() ?? "";
      },
    });
    await act(() => mutation.mutate());
    expect(seen).not.toBe("ready:1");
  });

  it("does not fail a committed write when the resolver throws; it withdraws everything", async () => {
    const client = productionClient();
    read.mockResolvedValue(view("w1", 1));
    mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
    read.mockResolvedValue(view("w1", 2));
    const mutation = new TanstackMutationObserver(client, {
      mutationFn: async () => "saved",
      meta: {
        audits: {
          targets: () => {
            throw new Error("bad resolver");
          },
        },
      },
    });
    await act(() => mutation.mutate());
    expect(mutation.getCurrentResult().status).toBe("success");
    await waitFor(() => expect(status()).toBe("ready:2"));
  });

  it("leaves a mutation without meta.audits alone", async () => {
    const client = productionClient();
    read.mockResolvedValue(view("w1", 1));
    mountProbe(client);
    await waitFor(() => expect(status()).toBe("ready:1"));
    const mutation = new TanstackMutationObserver(client, {
      mutationFn: async () => "ok",
    });
    await act(() => mutation.mutate());
    expect(read).toHaveBeenCalledOnce();
    expect(status()).toBe("ready:1");
  });
});

it("admits both observers of the same shared read", async () => {
  read.mockResolvedValue(view("w1"));
  render(
    <QueryClientProvider client={productionClient()}>
      <Probe target={workspace("w1")} name="first" />
      <Probe target={workspace("w1")} name="second" />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId("first").textContent).toBe("ready:1");
    expect(screen.getByTestId("second").textContent).toBe("ready:1");
  });
  expect(read).toHaveBeenCalledOnce();
});

it("uses the mutation's original metadata after its observer changes options", async () => {
  const client = productionClient();
  read.mockImplementation(async (_type, id) => view(id));
  render(
    <QueryClientProvider client={client}>
      <Probe target={workspace("w1")} name="first" />
      <Probe target={workspace("w2")} name="second" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  const pending = deferred<string>();
  const mutation = new TanstackMutationObserver(client, {
    mutationFn: () => pending.promise,
    meta: { audits: { targets: () => [workspace("w1")] } },
  });
  let completion!: Promise<string>;
  act(() => {
    completion = mutation.mutate();
  });
  mutation.setOptions({
    mutationFn: () => pending.promise,
    meta: { audits: { targets: () => [workspace("w2")] } },
  });
  await act(async () => {
    pending.resolve("ok");
    await completion;
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(read.mock.calls[2]?.[1]).toBe("w1");
});

it.each(["workspaceId", "projectId", "entityId", "entityType"])(
  "rejects mismatched history %s",
  async (field) => {
    read.mockResolvedValue({
      ...view("r1"),
      entityType: "hourly_rate",
      workspaceId: "w1",
      projectId: "p1",
      [field]: "other",
    });
    mountProbe(productionClient(), {
      kind: "entity",
      type: "hourly_rate",
      id: "r1",
      scope: { kind: "project", workspaceId: "w1", projectId: "p1" },
    });
    await waitFor(() => expect(status()).toBe("hidden"));
  },
);

it("admits rate history without reading the project", async () => {
  read.mockResolvedValue({
    ...view("r1"),
    entityType: "hourly_rate",
    workspaceId: "w1",
    projectId: "p1",
  });
  mountProbe(productionClient(), {
    kind: "entity",
    type: "hourly_rate",
    id: "r1",
    scope: { kind: "project", workspaceId: "w1", projectId: "p1" },
  });
  await waitFor(() => expect(status()).toBe("ready:1"));
});

it("admits an observer joining an already-running shared read", async () => {
  const pending = deferred<unknown>();
  read.mockReturnValue(pending.promise);
  const client = productionClient();
  const wrapper = (both: boolean) => (
    <QueryClientProvider client={client}>
      <Probe target={workspace("w1")} name="first" />
      {both && <Probe target={workspace("w1")} name="second" />}
    </QueryClientProvider>
  );
  const screenView = render(wrapper(false));
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  screenView.rerender(wrapper(true));
  await act(async () => pending.resolve(view("w1")));
  await waitFor(() =>
    expect(screen.getByTestId("second").textContent).toBe("ready:1"),
  );
});
