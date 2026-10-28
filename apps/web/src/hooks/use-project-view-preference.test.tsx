import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userSettingsQueryKey } from "./queries/user-settings/use-get-user-settings";
import {
  parseCollapsedGroups,
  parseTableColumns,
  useProjectViewPreference,
} from "./use-project-view-preference";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/fetchers/user-settings/user-settings", () => ({
  getUserSettings: api.get,
  patchUserSettings: api.patch,
}));

function setup(projectId: string | undefined = "proj_1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useProjectViewPreference({
        projectId,
        name: "listGroups",
        parse: parseCollapsedGroups,
      }),
    { wrapper },
  );
  return { queryClient, ...hook };
}

beforeEach(() => {
  api.get.mockReset();
  api.patch.mockReset();
  api.get.mockResolvedValue({
    settings: { "listGroups.proj_1": ["open"], density: "compact" },
  });
  api.patch.mockResolvedValue({ settings: {} });
});

describe("useProjectViewPreference (VW-15, VW-19)", () => {
  it("reads the stored value for this project from the user's settings", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.value).toEqual(["open"]));
  });

  it("ignores another project's value and a value of the wrong shape", async () => {
    api.get.mockResolvedValue({
      settings: { "listGroups.other": ["x"], "listGroups.proj_1": "open" },
    });
    const { result } = setup();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(result.current.value).toBeUndefined();
  });

  it("writes optimistically, patches only its own key, and keeps other settings", async () => {
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.value).toEqual(["open"]));

    act(() => result.current.set(["open", "done"]));

    await waitFor(() => expect(result.current.value).toEqual(["open", "done"]));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith({
        "listGroups.proj_1": ["open", "done"],
      }),
    );
    expect(
      queryClient.getQueryData<{ settings: Record<string, unknown> }>(
        userSettingsQueryKey("user-1"),
      )?.settings,
    ).toMatchObject({ density: "compact" });
  });

  it("clears the stored value with null", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.value).toEqual(["open"]));
    act(() => result.current.set(null));
    await waitFor(() => expect(result.current.value).toBeUndefined());
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith({ "listGroups.proj_1": null }),
    );
  });

  it("does not invent a partial settings object before the read has landed", async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    api.get.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    api.patch.mockResolvedValue({
      settings: { "listGroups.proj_1": ["done"], density: "compact" },
    });
    const { result, queryClient } = setup();

    act(() => result.current.set(["done"]));
    expect(
      queryClient.getQueryData(userSettingsQueryKey("user-1")),
    ).toBeUndefined();

    // The write's full answer becomes what the screen shows, density included.
    await waitFor(() => expect(result.current.value).toEqual(["done"]));
    expect(
      queryClient.getQueryData<{ settings: Record<string, unknown> }>(
        userSettingsQueryKey("user-1"),
      )?.settings.density,
    ).toBe("compact");
    resolveRead({ settings: {} });
  });

  it("does nothing without a project", async () => {
    const { result } = setup(undefined);
    act(() => result.current.set(["open"]));
    expect(api.patch).not.toHaveBeenCalled();
    expect(result.current.value).toBeUndefined();
  });

  it("refetches the server state when the write is refused", async () => {
    api.patch.mockRejectedValue(new Error("422"));
    const { result } = setup();
    await waitFor(() => expect(result.current.value).toEqual(["open"]));
    api.get.mockClear();
    act(() => result.current.set(["open", "done"]));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(result.current.value).toEqual(["open"]));
  });
});

describe("stored value parsers", () => {
  it("accepts only string id lists for collapsed groups", () => {
    expect(parseCollapsedGroups(["a", "b"])).toEqual(["a", "b"]);
    expect(parseCollapsedGroups([1])).toBeUndefined();
    expect(parseCollapsedGroups("a")).toBeUndefined();
  });

  it("accepts native and custom columns without duplicates", () => {
    expect(parseTableColumns(["key", "state"])).toEqual(["key", "state"]);
    expect(parseTableColumns(["key", "cf.constructor"])).toEqual([
      "key",
      "cf.constructor",
    ]);
    expect(parseTableColumns([])).toBeUndefined();
    expect(parseTableColumns(["key", "key"])).toBeUndefined();
    expect(parseTableColumns(["cf.Bad Key"])).toBeUndefined();
    expect(
      parseTableColumns(Array.from({ length: 101 }, (_, i) => `cf.f${i}`)),
    ).toBeUndefined();
  });
});
