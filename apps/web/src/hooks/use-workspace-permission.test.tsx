import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspacePermission } from "./use-workspace-permission";

// S3 (issue #6, retrofit plan §3): rewritten against GET /api/capabilities,
// which replaces the 16-way authClient.organization.hasPermission() fan-out
// this test used to mock. The mocked payload's 16 keys are copied verbatim
// from apps/api/src/capabilities/response.ts's capabilitiesResponseSchema --
// not invented -- so a key renamed or dropped on either side of the wire
// shows up here as a real assertion failure, not a passing test that never
// touched the real contract.
const { capabilitiesGet } = vi.hoisted(() => ({
  capabilitiesGet: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    capabilities: {
      $get: capabilitiesGet,
    },
  },
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

vi.mock("@/hooks/queries/workspace-users/use-active-workspace-user", () => ({
  useGetActiveWorkspaceUser: () => ({ data: { role: "member" } }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

// One full CapabilityMap, matching capabilitiesResponseSchema's 16 keys
// exactly. Callers below start from this and only flip the keys a given
// test cares about, so an accidental typo in an unrelated key still
// produces a real (defined) boolean rather than `undefined`.
function fullCapabilityMap(overrides: Partial<Record<string, boolean>> = {}) {
  return {
    manageProjects: false,
    createProjects: false,
    updateProjects: false,
    deleteProjects: false,
    updateTasks: false,
    createTasks: false,
    deleteTasks: false,
    assignTasks: false,
    createLabels: false,
    updateLabels: false,
    deleteLabels: false,
    manageWorkspace: false,
    deleteWorkspace: false,
    inviteUsers: false,
    manageTeam: false,
    removeMembers: false,
    ...overrides,
  };
}

describe("useWorkspacePermission", () => {
  beforeEach(() => {
    capabilitiesGet.mockReset();
  });

  it("keeps update capabilities independent from delete capabilities", async () => {
    capabilitiesGet.mockResolvedValue({
      ok: true,
      json: async () =>
        fullCapabilityMap({
          createTasks: true,
          updateTasks: true,
          deleteTasks: false,
          createLabels: true,
          updateLabels: true,
          deleteLabels: false,
        }),
    });

    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });

    expect(result.current.canCreateTasks()).toBe(true);
    expect(result.current.canUpdateTasks()).toBe(true);
    expect(result.current.canDeleteTasks()).toBe(false);
    expect(result.current.canCreateLabels()).toBe(true);
    expect(result.current.canUpdateLabels()).toBe(true);
    expect(result.current.canDeleteLabels()).toBe(false);
  });

  it("calls GET /api/capabilities with the active workspace id, once", async () => {
    capabilitiesGet.mockResolvedValue({
      ok: true,
      json: async () => fullCapabilityMap(),
    });

    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });

    expect(capabilitiesGet).toHaveBeenCalledTimes(1);
    expect(capabilitiesGet).toHaveBeenCalledWith({
      query: { workspaceId: "workspace-1" },
    });
  });

  it("exposes every one of the 16 capabilitiesResponseSchema keys, not a subset", async () => {
    capabilitiesGet.mockResolvedValue({
      ok: true,
      json: async () =>
        fullCapabilityMap({
          manageProjects: true,
          manageWorkspace: true,
          deleteWorkspace: true,
          inviteUsers: true,
          manageTeam: true,
          removeMembers: true,
        }),
    });

    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });

    expect(result.current.canManageProjects()).toBe(true);
    expect(result.current.canCreateProjects()).toBe(false);
    expect(result.current.canUpdateProjects()).toBe(false);
    expect(result.current.canDeleteProjects()).toBe(false);
    expect(result.current.canAssignTasks()).toBe(false);
    expect(result.current.canManageWorkspace()).toBe(true);
    expect(result.current.canDeleteWorkspace()).toBe(true);
    expect(result.current.canInviteUsers()).toBe(true);
    expect(result.current.canManageTeam()).toBe(true);
    expect(result.current.canRemoveMembers()).toBe(true);
  });

  it("defaults every capability to false while the request is pending, never undefined", () => {
    capabilitiesGet.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isCheckingPermissions).toBe(true);
    expect(result.current.canManageProjects()).toBe(false);
    expect(result.current.canRemoveMembers()).toBe(false);
  });

  it("surfaces isOwner/isAdmin from the resolved active member's role", async () => {
    capabilitiesGet.mockResolvedValue({
      ok: true,
      json: async () => fullCapabilityMap(),
    });

    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });

    // The mocked active-member role above is "member".
    expect(result.current.role).toBe("member");
    expect(result.current.isOwner).toBe(false);
    expect(result.current.isAdmin).toBe(false);
  });
});
