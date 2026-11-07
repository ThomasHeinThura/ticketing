import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * L-03: the old /dashboard/workspace/{id}/members link redirects to the canonical settings page
 * for the active workspace; a link naming another workspace still shows that workspace's list.
 */
const mocks = vi.hoisted(() => ({
  workspaceId: "ws-1",
  activeWorkspace: { id: "ws-1" } as { id: string } | undefined,
  activeLoading: false,
  membersTable: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ workspaceId: mocks.workspaceId }),
  }),
  Navigate: (props: { to: string; replace?: boolean }) => (
    <div
      data-testid="navigate"
      data-to={props.to}
      data-replace={String(props.replace)}
    />
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/common/workspace-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({
    data: mocks.activeWorkspace,
    isLoading: mocks.activeLoading,
  }),
}));
vi.mock("@/hooks/queries/workspace/use-get-full-workspace", () => ({
  default: ({ workspaceId }: { workspaceId: string }) => ({
    data: { id: workspaceId, members: [], pendingInvitations: [] },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canInviteUsers: () => false }),
}));
vi.mock("@/components/team/members-table", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.membersTable(props);
    return <div data-testid="members-table" />;
  },
}));
vi.mock("@/components/team/invite-team-member-modal", () => ({
  default: () => null,
}));

import { Route } from "./members";

const Page = (Route as unknown as { component: ComponentType }).component;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.workspaceId = "ws-1";
  mocks.activeWorkspace = { id: "ws-1" };
  mocks.activeLoading = false;
});

describe("old workspace members link (L-03)", () => {
  it("redirects the active workspace's link to the canonical settings page", () => {
    render(<Page />);
    const navigate = screen.getByTestId("navigate");
    expect(navigate.dataset.to).toBe("/dashboard/settings/workspace/members");
    expect(navigate.dataset.replace).toBe("true");
    expect(screen.queryByTestId("members-table")).toBeNull();
  });

  it("renders nothing while the active workspace is loading", () => {
    mocks.activeWorkspace = undefined;
    mocks.activeLoading = true;
    const { container } = render(<Page />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the named workspace's members when it is not the active one", () => {
    mocks.workspaceId = "ws-2";
    render(<Page />);
    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(mocks.membersTable).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-2" }),
    );
  });
});
