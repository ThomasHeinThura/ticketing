import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route as InvitationsRoute } from "@/routes/agent/_layout/_authenticated/invitations";
import { translate } from "@/test/en-translation";
import { OnboardingFlow } from "./onboarding-flow";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  canCreate: false,
  isLoading: false,
  workspaces: [] as { id: string }[],
  workspaceError: null as Error | null,
  workspacesLoading: false,
  workspacesFetching: false,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  createFileRoute: () => (options: unknown) => ({ options }),
  Navigate: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
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
vi.mock("@/lib/format", () => ({ formatDateMedium: () => "date" }));
vi.mock("@/hooks/queries/invitation/use-pending-invitations", () => ({
  usePendingInvitations: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/mutations/workspace-user/use-accept-invitation", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/workspace-user/use-reject-invitation", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({
    data: mocks.workspaces,
    error: mocks.workspaceError,
    isLoading: mocks.workspacesLoading,
    isFetching: mocks.workspacesFetching,
    refetch: vi.fn(),
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
  mocks.navigate.mockClear();
  mocks.canCreate = false;
  mocks.isLoading = false;
  mocks.workspaces = [];
  mocks.workspaceError = null;
  mocks.workspacesLoading = false;
  mocks.workspacesFetching = false;
});

describe("OnboardingFlow (D-A, 12 Nov 2026)", () => {
  it("does not read computed styles while rendering the motion transition", () => {
    mocks.canCreate = true;
    const computedStyle = vi.spyOn(window, "getComputedStyle");
    try {
      render(<OnboardingFlow />);
      expect(computedStyle).not.toHaveBeenCalled();
    } finally {
      computedStyle.mockRestore();
    }
  });
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

  it("redirects an existing member from onboarding, including after invitation continuation", () => {
    mocks.workspaces = [{ id: "workspace-1" }];
    render(<OnboardingFlow />);
    expect(screen.getByTestId("redirect")).toHaveTextContent("/agent");
    expect(screen.queryByTestId("no-workspace-empty")).toBeNull();
  });

  it("continues from invitations to onboarding and redirects an existing member", () => {
    mocks.workspaces = [{ id: "workspace-1" }];
    const InvitationsPage = InvitationsRoute.options.component;
    if (!InvitationsPage) throw new Error("Invitations component missing");
    const { unmount } = render(<InvitationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Setup" }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/onboarding" });
    unmount();
    render(<OnboardingFlow />);
    expect(screen.getByTestId("redirect")).toHaveTextContent("/agent");
    expect(screen.queryByTestId("no-workspace-empty")).toBeNull();
  });

  it("does not claim no membership while discovery is pending or failed", () => {
    mocks.workspacesLoading = true;
    const { rerender } = render(<OnboardingFlow />);
    expect(screen.queryByTestId("no-workspace-empty")).toBeNull();
    mocks.workspacesLoading = false;
    mocks.workspacesFetching = true;
    rerender(<OnboardingFlow />);
    expect(screen.queryByTestId("no-workspace-empty")).toBeNull();
    mocks.workspacesFetching = false;
    mocks.workspaceError = new Error("failed");
    rerender(<OnboardingFlow />);
    expect(screen.queryByTestId("no-workspace-empty")).toBeNull();
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
