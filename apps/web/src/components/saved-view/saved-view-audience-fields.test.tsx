import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import {
  availableVisibilities,
  SavedViewAudienceFields,
} from "./saved-view-audience-fields";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(`savedViews:${key}`, options),
  }),
}));

afterEach(cleanup);

describe("which audiences a caller may choose (SV-15, SV-16, SV-18)", () => {
  it("offers private only, by default and without capabilities", () => {
    expect(
      availableVisibilities({ canShare: false, canManageSettings: false }),
    ).toEqual(["private"]);
  });

  it("offers team with saved_view:share and workspace with workspace:manage_settings", () => {
    expect(
      availableVisibilities({ canShare: true, canManageSettings: false }),
    ).toEqual(["private", "team"]);
    expect(
      availableVisibilities({ canShare: false, canManageSettings: true }),
    ).toEqual(["private", "workspace"]);
    expect(
      availableVisibilities({ canShare: true, canManageSettings: true }),
    ).toEqual(["private", "team", "workspace"]);
  });

  it("keeps a view's current audience visible to someone who could not have chosen it", () => {
    expect(
      availableVisibilities({
        canShare: false,
        canManageSettings: false,
        current: "workspace",
      }),
    ).toEqual(["private", "workspace"]);
  });
});

describe("SavedViewAudienceFields", () => {
  const noTeams = { data: undefined, isLoading: false, isError: false };

  it("shows the translated label of the current visibility, not its id", () => {
    render(
      <SavedViewAudienceFields
        visibility="workspace"
        teamId=""
        onVisibilityChange={vi.fn()}
        onTeamChange={vi.fn()}
        canShare={false}
        canManageSettings
        teams={noTeams}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Visibility" }),
    ).toHaveTextContent("Workspace");
  });

  it("shows no team chooser unless the view is a team view", () => {
    render(
      <SavedViewAudienceFields
        visibility="private"
        teamId=""
        onVisibilityChange={vi.fn()}
        onTeamChange={vi.fn()}
        canShare
        canManageSettings={false}
        teams={noTeams}
      />,
    );
    expect(screen.queryByRole("combobox", { name: "Team" })).toBeNull();
  });

  it("offers only the caller's own teams for a team view, and disables the chooser without the capability", () => {
    const { rerender } = render(
      <SavedViewAudienceFields
        visibility="team"
        teamId="team-1"
        onVisibilityChange={vi.fn()}
        onTeamChange={vi.fn()}
        canShare
        canManageSettings={false}
        teams={{
          data: [{ id: "team-1", name: "Service desk" }],
          isLoading: false,
          isError: false,
        }}
      />,
    );
    const team = screen.getByRole("combobox", { name: "Team" });
    expect(team).toHaveTextContent("Service desk");
    expect(team).not.toBeDisabled();

    rerender(
      <SavedViewAudienceFields
        visibility="team"
        teamId="team-1"
        onVisibilityChange={vi.fn()}
        onTeamChange={vi.fn()}
        canShare={false}
        canManageSettings={false}
        currentVisibility="team"
        teams={{
          data: [{ id: "team-1", name: "Service desk" }],
          isLoading: false,
          isError: false,
        }}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Team" })).toBeDisabled();
  });

  it("says the teams could not be loaded and keeps the chooser disabled", () => {
    render(
      <SavedViewAudienceFields
        visibility="team"
        teamId=""
        onVisibilityChange={vi.fn()}
        onTeamChange={vi.fn()}
        canShare
        canManageSettings={false}
        teams={{ data: undefined, isLoading: false, isError: true }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      translate("savedViews:team.loadError"),
    );
    expect(screen.getByRole("combobox", { name: "Team" })).toBeDisabled();
  });

  it("reports a visibility choice through the callback", () => {
    const onVisibilityChange = vi.fn();
    render(
      <SavedViewAudienceFields
        visibility="private"
        teamId=""
        onVisibilityChange={onVisibilityChange}
        onTeamChange={vi.fn()}
        canShare
        canManageSettings={false}
        teams={noTeams}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Visibility" }));
    const option = screen.getByRole("option", { name: "Team" });
    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);
    expect(onVisibilityChange).toHaveBeenCalledWith("team");
    expect(screen.queryByRole("option", { name: "Workspace" })).toBeNull();
  });
});
