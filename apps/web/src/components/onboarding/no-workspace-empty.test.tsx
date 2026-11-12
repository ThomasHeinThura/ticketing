import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { NoWorkspaceEmpty } from "./no-workspace-empty";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock("@/components/common/logo", () => ({ Logo: () => null }));

afterEach(() => {
  cleanup();
  mocks.navigate.mockReset();
});

describe("NoWorkspaceEmpty", () => {
  it("tells a person with no workspace to ask an administrator for an invitation", () => {
    render(<NoWorkspaceEmpty />);

    expect(screen.getByTestId("no-workspace-empty")).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "You are not a member of any workspace yet.",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("Ask an administrator for an invitation."),
    ).toBeVisible();
  });

  it("offers no way to create a workspace, and keeps the invitations page one click away", () => {
    render(<NoWorkspaceEmpty />);

    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "View my invitations" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/invitations" });
  });
});
