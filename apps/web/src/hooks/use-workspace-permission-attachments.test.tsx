import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspacePermission } from "./use-workspace-permission";

const { getCapabilities } = vi.hoisted(() => ({ getCapabilities: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({
  client: { capabilities: { $get: getCapabilities } },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "active-workspace" } }),
}));
vi.mock("@/hooks/queries/workspace-users/use-active-workspace-user", () => ({
  useGetActiveWorkspaceUser: () => ({ data: { role: "owner" } }),
}));

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  getCapabilities.mockReset();
});

describe("attachment creation permission", () => {
  it.each([undefined, false, "true", 1])(
    "fails closed for optional or nonboolean flag %s despite task writes and owner role",
    async (createAttachments) => {
      getCapabilities.mockResolvedValue({
        ok: true,
        json: async () => ({
          createAttachments,
          createTasks: true,
          updateTasks: true,
        }),
      });
      const { result } = renderHook(() => useWorkspacePermission(), {
        wrapper: createWrapper(),
      });
      await waitFor(() =>
        expect(result.current.isCheckingPermissions).toBe(false),
      );
      expect(result.current.isOwner).toBe(true);
      expect(result.current.canCreateTasks()).toBe(true);
      expect(result.current.canUpdateTasks()).toBe(true);
      expect(result.current.canCreateAttachments()).toBe(false);
    },
  );

  it("uses only the explicitly granted attachment flag", async () => {
    getCapabilities.mockResolvedValue({
      ok: true,
      json: async () => ({
        createAttachments: true,
        createTasks: false,
        updateTasks: false,
      }),
    });
    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(result.current.canCreateAttachments()).toBe(true),
    );
    expect(result.current.canCreateTasks()).toBe(false);
    expect(result.current.canUpdateTasks()).toBe(false);
  });

  it("denies while loading", () => {
    getCapabilities.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });
    expect(result.current.canCreateAttachments()).toBe(false);
  });

  it("denies a failed capability lookup", async () => {
    getCapabilities.mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(getCapabilities).toHaveBeenCalledTimes(1));
    expect(result.current.canCreateAttachments()).toBe(false);
  });

  it("does not reuse another workspace or project's upload grant", async () => {
    getCapabilities.mockImplementation(
      ({ query }: { query: { workspaceId: string; projectId: string } }) => ({
        ok: true,
        json: async () => ({
          createAttachments:
            query.workspaceId === "target-workspace" &&
            query.projectId === "editable-project",
        }),
      }),
    );
    const { result, rerender } = renderHook(
      ({ workspaceId, projectId }) =>
        useWorkspacePermission(workspaceId, projectId),
      {
        initialProps: {
          workspaceId: "target-workspace",
          projectId: "editable-project",
        },
        wrapper: createWrapper(),
      },
    );
    await waitFor(() =>
      expect(result.current.canCreateAttachments()).toBe(true),
    );
    expect(getCapabilities).toHaveBeenCalledWith({
      query: {
        workspaceId: "target-workspace",
        projectId: "editable-project",
      },
    });

    rerender({
      workspaceId: "target-workspace",
      projectId: "read-only-project",
    });
    expect(result.current.canCreateAttachments()).toBe(false);
    await waitFor(() =>
      expect(getCapabilities).toHaveBeenCalledWith({
        query: {
          workspaceId: "target-workspace",
          projectId: "read-only-project",
        },
      }),
    );
    rerender({
      workspaceId: "other-workspace",
      projectId: "editable-project",
    });
    expect(result.current.canCreateAttachments()).toBe(false);
    await waitFor(() =>
      expect(getCapabilities).toHaveBeenCalledWith({
        query: {
          workspaceId: "other-workspace",
          projectId: "editable-project",
        },
      }),
    );
    expect(result.current.canCreateAttachments()).toBe(false);
  });
});
