import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * L-03: /dashboard/settings/workspace/members is the canonical members page. It renders Kaneo's
 * members table inside the settings frame instead of hopping on to /dashboard/workspace/{id}.
 */
const mocks = vi.hoisted(() => ({
  activeWorkspace: { id: "ws-1" } as { id: string } | undefined,
  activeLoading: false,
  canInvite: true,
  membersTable: vi.fn(),
  inviteModal: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  Navigate: (props: { to: string }) => (
    <div data-testid="navigate" data-to={props.to} />
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({
    data: mocks.activeWorkspace,
    isLoading: mocks.activeLoading,
  }),
}));
vi.mock("@/hooks/queries/workspace/use-get-full-workspace", () => ({
  default: ({ workspaceId }: { workspaceId: string }) => ({
    data: {
      id: workspaceId,
      members: [{ id: "u-1" }],
      pendingInvitations: [{ id: "inv-1" }],
    },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canInviteUsers: () => mocks.canInvite }),
}));
vi.mock("@/components/team/members-table", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.membersTable(props);
    return <div data-testid="members-table" />;
  },
}));
vi.mock("@/components/team/invite-team-member-modal", () => ({
  default: (props: { open: boolean }) => {
    mocks.inviteModal(props);
    return props.open ? <div data-testid="invite-modal" /> : null;
  },
}));

import { Route } from "./members";

const Page = (Route as unknown as { component: ComponentType }).component;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.activeWorkspace = { id: "ws-1" };
  mocks.activeLoading = false;
  mocks.canInvite = true;
});

describe("workspace settings members (L-03)", () => {
  it("renders the active workspace's members in place, without redirecting", () => {
    render(<Page />);
    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "team:members.pageTitle" }),
    ).toBeTruthy();
    expect(screen.getByTestId("members-table")).toBeTruthy();
    expect(mocks.membersTable).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      users: [{ id: "u-1" }],
      invitations: [{ id: "inv-1" }],
    });
  });

  it("offers the invite action to people who can invite and opens the invite dialog", () => {
    render(<Page />);
    fireEvent.click(
      screen.getByRole("button", { name: "team:members.inviteMember" }),
    );
    expect(screen.getByTestId("invite-modal")).toBeTruthy();
  });

  it("hides the invite action from people who cannot invite", () => {
    mocks.canInvite = false;
    render(<Page />);
    expect(
      screen.queryByRole("button", { name: "team:members.inviteMember" }),
    ).toBeNull();
    expect(screen.getByTestId("members-table")).toBeTruthy();
  });

  it("shows a loading state until the active workspace is known", () => {
    mocks.activeWorkspace = undefined;
    mocks.activeLoading = true;
    render(<Page />);
    expect(
      screen.getByRole("status", { name: "common:empty.loading" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("members-table")).toBeNull();
  });

  it("keeps the person search `q` in the URL", () => {
    const validateSearch = (
      Route as unknown as { validateSearch: (raw: unknown) => unknown }
    ).validateSearch;
    expect(validateSearch({ q: "ada" })).toEqual({ q: "ada" });
  });
});
