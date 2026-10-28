import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectViewPreferenceWithSave } from "./use-project-view-preference-with-save";

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
      useProjectViewPreferenceWithSave({
        projectId,
        name: "columnWidths",
        parse: (raw) =>
          typeof raw === "object" && raw !== null
            ? (raw as Record<string, number>)
            : undefined,
      }),
    { wrapper },
  );
  return hook;
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({
    settings: { "columnWidths.proj_1": { title: 320 }, density: "compact" },
  });
  api.patch.mockReset().mockResolvedValue({ settings: {} });
});

describe("useProjectViewPreferenceWithSave", () => {
  it("resolves after a project-scoped preference write succeeds", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.value).toEqual({ title: 320 }));

    await act(async () => {
      await expect(
        result.current.setAsync({ title: 360 }),
      ).resolves.toBeUndefined();
    });
    expect(api.patch).toHaveBeenCalledWith({
      "columnWidths.proj_1": { title: 360 },
    });
  });

  it("rejects refusal after the shared hook invalidates settings", async () => {
    api.patch.mockRejectedValue(new Error("settings write refused"));
    const { result } = setup();
    await waitFor(() => expect(result.current.value).toEqual({ title: 320 }));

    await act(async () => {
      await expect(result.current.setAsync({ title: 360 })).rejects.toThrow(
        "settings write refused",
      );
    });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it("rejects when no project-scoped preference can be written", async () => {
    const { result } = setup("");
    await expect(result.current.setAsync({ title: 360 })).rejects.toThrow(
      "User settings are unavailable",
    );
    expect(api.patch).not.toHaveBeenCalled();
  });
});
