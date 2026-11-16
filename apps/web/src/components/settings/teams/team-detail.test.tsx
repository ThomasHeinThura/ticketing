import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamDetail } from "@/fetchers/team";

const mocks = vi.hoisted(() => ({
  updateTeam: vi.fn(),
  requestTeamDeletion: vi.fn(),
  openPendingAction: vi.fn(),
  team: null as TeamDetail | null,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPendingAction,
}));
vi.mock("@/hooks/queries/team/use-teams", () => ({
  teamsKey: (workspaceId: string) => ["teams", workspaceId],
  useTeam: () => ({ data: mocks.team, isLoading: false, isError: false }),
}));
vi.mock("@/fetchers/team", () => ({
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  requestTeamDeletion: (...args: unknown[]) =>
    mocks.requestTeamDeletion(...args),
  updateTeam: (...args: unknown[]) => mocks.updateTeam(...args),
  updateTeamMember: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TeamDetailView, TeamSettingsCard } from "./team-detail";

const team = {
  id: "t1",
  workspaceId: "w1",
  name: "Support",
  capacityDaysPerWeek: null,
  isCab: false,
  canManageTeam: true,
  canEditRoster: true,
  members: [],
  candidates: [],
  deletionBlockers: [],
} as unknown as TeamDetail;

afterEach(cleanup);

describe("TeamSettingsCard", () => {
  it("reports a successful save after refreshing team data", async () => {
    mocks.updateTeam.mockReset().mockResolvedValue({});
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamSettingsCard team={team} onSaved={onSaved} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("teams:fields.name"), {
      target: { value: "Help desk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "teams:detail.save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.updateTeam).toHaveBeenCalledOnce();
  });
  it.each(["viewer", "member", "lead"])(
    "shows values without edit controls to a %s without team management",
    () => {
      render(
        <QueryClientProvider client={new QueryClient()}>
          <TeamSettingsCard team={{ ...team, canManageTeam: false }} />
        </QueryClientProvider>,
      );
      expect(screen.getByText("Support")).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("spinbutton")).toBeNull();
      expect(screen.queryByRole("switch")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "teams:detail.save" }),
      ).toBeNull();
    },
  );
  it("clears a CAB refusal when the CAB switch is toggled again", async () => {
    mocks.updateTeam.mockRejectedValue(new Error("A CAB needs a member"));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamSettingsCard team={team} />
      </QueryClientProvider>,
    );
    const cab = screen.getByRole("switch");
    fireEvent.click(cab);
    fireEvent.click(screen.getByRole("button", { name: "teams:detail.save" }));
    expect(await screen.findByText("A CAB needs a member")).toBeTruthy();
    fireEvent.click(cab);
    await waitFor(() =>
      expect(screen.queryByText("A CAB needs a member")).toBeNull(),
    );
  });
});

describe("TeamDetailView deletion", () => {
  it("uses the existing danger card and opens the shared pending action", async () => {
    mocks.team = team;
    mocks.requestTeamDeletion.mockReset().mockResolvedValue({
      pendingActionId: "pa-team",
    });
    mocks.openPendingAction.mockReset();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamDetailView teamId={team.id} showInactive={false} />
      </QueryClientProvider>,
    );
    const button = screen.getByRole("button", { name: "teams:delete.action" });
    expect(button.closest('[data-slot="card"]')).toHaveClass(
      "border-destructive/32",
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pa-team",
        finalFocus: expect.any(Function),
      }),
    );
    expect(mocks.openPendingAction.mock.calls[0]?.[0].finalFocus()).toBe(
      button,
    );
    expect(mocks.requestTeamDeletion).toHaveBeenCalledWith(team.id);
  });

  it("retains deletion blockers and hides deletion without management permission", () => {
    mocks.team = { ...team, deletionBlockers: ["This team owns a project"] };
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamDetailView teamId={team.id} showInactive={false} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("This team owns a project")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "teams:delete.action" }),
    ).toBeDisabled();
    mocks.team = { ...team, canManageTeam: false };
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TeamDetailView teamId={team.id} showInactive={false} />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByRole("button", { name: "teams:delete.action" }),
    ).toBeNull();
  });
});
