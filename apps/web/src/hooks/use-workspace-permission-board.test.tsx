import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspacePermission } from "./use-workspace-permission";

const { capabilitiesGet } = vi.hoisted(() => ({ capabilitiesGet: vi.fn() }));

vi.mock("@taskdesk/libs", () => ({
  client: { capabilities: { $get: capabilitiesGet } },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));
vi.mock("@/hooks/queries/workspace-users/use-active-workspace-user", () => ({
  useGetActiveWorkspaceUser: () => ({ data: { role: "member" } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

const base = {
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
  manageServiceCalendars: false,
};

async function load(overrides: Record<string, boolean>) {
  capabilitiesGet.mockResolvedValue({
    ok: true,
    json: async () => ({ ...base, ...overrides }),
  });
  const { result } = renderHook(() => useWorkspacePermission(), { wrapper });
  await waitFor(() => expect(result.current.isCheckingPermissions).toBe(false));
  return result.current;
}

describe("strict board capabilities", () => {
  beforeEach(() => {
    capabilitiesGet.mockReset();
  });

  it("canRankTasks and canTransitionTasks follow only rankTasks and transitionTasks", async () => {
    const broad = await load({ updateTasks: true, assignTasks: true });
    expect(broad.canRankTasks()).toBe(false);
    expect(broad.canTransitionTasks()).toBe(false);
    const rankOnly = await load({ rankTasks: true });
    expect(rankOnly.canRankTasks()).toBe(true);
    expect(rankOnly.canTransitionTasks()).toBe(false);
    const transitionOnly = await load({ transitionTasks: true });
    expect(transitionOnly.canTransitionTasks()).toBe(true);
    expect(transitionOnly.canRankTasks()).toBe(false);
  });

  it("fails closed when an older server omits the strict flags", async () => {
    const caps = await load({ updateTasks: true });
    expect(caps.canRankTasks()).toBe(false);
    expect(caps.canTransitionTasks()).toBe(false);
  });

  it("is false for every strict flag while the request is pending", () => {
    capabilitiesGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useWorkspacePermission(), { wrapper });
    expect(result.current.canRankTasks()).toBe(false);
    expect(result.current.canTransitionTasks()).toBe(false);
    expect(result.current.canManageProjectSettings()).toBe(false);
  });
});
