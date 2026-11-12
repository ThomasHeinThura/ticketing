import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { OnboardingFlow } from "./onboarding-flow";

const mocks = vi.hoisted(() => ({
  canCreate: false,
  isLoading: false,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));
vi.mock("@/components/common/logo", () => ({ Logo: () => null }));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({
    user: { id: "u-1", name: "Admin" },
    isLoading: mocks.isLoading,
  }),
}));
vi.mock("@/hooks/use-can-create-workspace", () => ({
  default: () => mocks.canCreate,
}));
vi.mock("@/hooks/queries/workspace/use-create-workspace", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/workspace/workspace-owner-picker", () => ({
  WorkspaceOwnerPicker: () => <div data-testid="owner-picker" />,
}));
vi.mock("@/fetchers/workspace/activate-workspace", () => ({
  default: vi.fn(),
}));

afterEach(() => {
  cleanup();
  mocks.canCreate = false;
  mocks.isLoading = false;
});

describe("OnboardingFlow (D-A, 12 Nov 2026)", () => {
  it("shows the no-workspace screen, and no create form, to a person who may not create workspaces", () => {
    render(<OnboardingFlow />);

    expect(screen.getByTestId("no-workspace-empty")).toBeVisible();
    expect(
      screen.getByText("Ask an administrator for an invitation."),
    ).toBeVisible();
    expect(screen.queryByTestId("owner-picker")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create workspace" }),
    ).toBeNull();
  });

  it("shows the create form with an owner picker to an instance admin", () => {
    mocks.canCreate = true;
    render(<OnboardingFlow />);

    expect(screen.queryByTestId("no-workspace-empty")).toBeNull();
    // The form fades in (opacity 0 first), so assert presence rather than visibility.
    expect(screen.getByTestId("owner-picker")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create workspace" }),
    ).toBeInTheDocument();
  });

  it("shows neither screen while the signed-in role is still loading", () => {
    mocks.isLoading = true;
    render(<OnboardingFlow />);

    expect(screen.queryByTestId("no-workspace-empty")).toBeNull();
    expect(screen.queryByTestId("owner-picker")).toBeNull();
  });
});
