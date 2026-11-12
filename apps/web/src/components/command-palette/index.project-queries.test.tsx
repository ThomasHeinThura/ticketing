import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./index";

/**
 * The palette reads the route's project and the actor's permission in it to offer "Create work
 * item". These tests use the real `useProjectByKey`, `useWorkspacePermission` and membership
 * hooks, with only the network calls mocked, to prove what the palette asks the server for.
 */
const mocks = vi.hoisted(() => ({
  params: {} as { projectKey?: string },
  getProjects: vi.fn(),
  getMembers: vi.fn(),
  capabilitiesGet: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => mocks.params,
  useRouter: () => ({ preloadRoute: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: undefined }) },
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: undefined }),
}));
vi.mock("@/hooks/queries/search/use-global-search", () => ({
  default: () => ({ data: { results: [] } }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" }, isLoading: false }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => ({ setTheme: vi.fn() }),
}));
vi.mock("@/fetchers/project/get-projects", () => ({
  default: (...args: unknown[]) => mocks.getProjects(...args),
}));
vi.mock("@/fetchers/workspace-user/get-active-workspace-users", () => ({
  default: (...args: unknown[]) => mocks.getMembers(...args),
}));
vi.mock("@taskdesk/libs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taskdesk/libs")>()),
  client: {
    capabilities: {
      $get: (...args: unknown[]) => mocks.capabilitiesGet(...args),
    },
  },
}));

beforeEach(() => {
  mocks.params = {};
  mocks.getProjects.mockReset();
  mocks.getMembers.mockReset();
  mocks.capabilitiesGet.mockReset();
  mocks.getProjects.mockResolvedValue([
    { id: "p1", workspaceId: "w1", slug: "HELP", name: "Help desk" },
  ]);
  mocks.getMembers.mockResolvedValue({
    members: [
      {
        userId: "u1",
        personId: null,
        role: "member",
        user: { name: "Una", email: "una@example.test", image: null },
      },
    ],
  });
  mocks.capabilitiesGet.mockResolvedValue({
    ok: true,
    json: async () => ({ createTasks: true }),
  });
});
afterEach(() => cleanup());

async function renderPalette() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CommandPalette
        open={false}
        onOpenChange={() => {}}
        request={null}
        onRequestHandled={() => {}}
        keepMounted={false}
      />
    </QueryClientProvider>,
  );
  // Let any query the mounted palette starts reach its network call.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("CommandPalette project and permission reads", () => {
  it("asks the server for no project, membership or capability outside a project", async () => {
    await renderPalette();

    expect(mocks.getProjects).not.toHaveBeenCalled();
    expect(mocks.getMembers).not.toHaveBeenCalled();
    expect(mocks.capabilitiesGet).not.toHaveBeenCalled();
  });

  it("inside a project reads the project list, then only that project's capabilities", async () => {
    mocks.params = { projectKey: "HELP" };
    await renderPalette();

    await waitFor(() => expect(mocks.capabilitiesGet).toHaveBeenCalled());
    expect(mocks.getProjects).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "w1" }),
    );
    // No workspace-wide capability read while the project was still loading.
    for (const [call] of mocks.capabilitiesGet.mock.calls)
      expect(call).toEqual({
        query: { workspaceId: "w1", projectId: "p1" },
      });
  });
});
