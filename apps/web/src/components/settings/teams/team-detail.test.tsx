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

const mocks = vi.hoisted(() => ({ updateTeam: vi.fn() }));

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
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/fetchers/team", () => ({
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  requestTeamDeletion: vi.fn(),
  updateTeam: (...args: unknown[]) => mocks.updateTeam(...args),
  updateTeamMember: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TeamSettingsCard } from "./team-detail";

const team = {
  id: "t1",
  workspaceId: "w1",
  name: "Support",
  capacityDaysPerWeek: null,
  isCab: false,
  canManageTeam: true,
} as unknown as TeamDetail;

afterEach(cleanup);

describe("TeamSettingsCard", () => {
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
