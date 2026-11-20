import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { refreshSettingsHistory } from "./refresh-settings-history";

it.each(["settings-history", "personal-settings-history"])(
  "replaces a stale initial %s read after successive saves",
  async (kind) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = [kind, "saved", "session"];
    let finishOld!: (value: string) => void;
    const fetchHistory = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValue("latest");
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: fetchHistory,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(fetchHistory).toHaveBeenCalledTimes(1));
    refreshSettingsHistory(client, key, async () => {});
    refreshSettingsHistory(client, key, async () => {});
    finishOld("before save");
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toBe("latest"),
    );
    expect(fetchHistory.mock.calls.length).toBeGreaterThanOrEqual(2);
    unsubscribe();
    client.clear();
  },
);
it("marks only the captured key stale and does not refetch after identity refusal", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const oldKey = [
    "personal-settings-history",
    "host",
    "profile",
    "old",
    "old-session",
  ];
  const newKey = [
    "personal-settings-history",
    "host",
    "profile",
    "new",
    "new-session",
  ];
  const oldFetch = vi.fn(() => new Promise(() => {}));
  const old = new QueryObserver(client, {
    queryKey: oldKey,
    queryFn: oldFetch,
  });
  const stop = old.subscribe(() => {});
  client.setQueryData(newKey, "untouched");
  await vi.waitFor(() => expect(oldFetch).toHaveBeenCalledOnce());
  refreshSettingsHistory(client, oldKey, async () => {
    throw new Error("session changed");
  });
  await vi.waitFor(() =>
    expect(client.getQueryState(oldKey)?.isInvalidated).toBe(true),
  );
  expect(oldFetch).toHaveBeenCalledOnce();
  expect(client.getQueryData(newKey)).toBe("untouched");
  expect(client.getQueryState(newKey)?.isInvalidated).toBe(false);
  stop();
  client.clear();
});
it("leaves the active query in its error state when the replacement read fails", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = ["settings-history", "project", "p", "agent", "u", "s"];
  const fetchHistory = vi
    .fn()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockRejectedValueOnce(new Error("refused"));
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: fetchHistory,
  });
  const stop = observer.subscribe(() => {});
  await vi.waitFor(() => expect(fetchHistory).toHaveBeenCalledOnce());
  refreshSettingsHistory(client, key, async () => {});
  await vi.waitFor(() =>
    expect(observer.getCurrentResult().isError).toBe(true),
  );
  stop();
  client.clear();
});
