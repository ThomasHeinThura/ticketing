import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PendingActionApprovalDialog from "@/components/pending-action/pending-action-approval-dialog";
import usePendingActionDialogStore from "@/store/pending-action-dialog";
import { AppI18nProvider } from "./provider";

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  publicTerminology: vi.fn(),
  factorStatus: vi.fn(),
  approve: vi.fn(),
  cancel: vi.fn(),
  proof: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { locale: "en-US" } }),
}));

vi.mock("@/fetchers/terminology", () => ({
  getPortalTerminology: vi.fn(),
  getPublicTerminology: mocks.publicTerminology,
  getWorkspaceRuntimeTerminology: vi.fn(),
}));

vi.mock("@/fetchers/pending-actions", () => ({
  approveOwnPendingAction: mocks.approve,
  cancelOwnPendingAction: mocks.cancel,
  createPendingActionProof: mocks.proof,
  getOwnPendingAction: mocks.action,
}));

vi.mock("@/fetchers/god-mode/instance-users", () => ({
  getCurrentFactorStatus: mocks.factorStatus,
  getInstanceUser: vi.fn(),
}));

vi.mock("@/hooks/queries/god-mode/use-instance-users", () => ({
  instanceUsersKey: ["instance-users"],
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: undefined }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useLocation: () => ({ pathname: "/agent/dashboard", hash: "" }),
  };
});

const organisationPurge = {
  id: "pa-org-purge",
  action: "purge",
  targetType: "organisation",
  targetIds: ["opaque-organisation-id"],
  summary: {
    targetType: "organisation",
    targetId: "opaque-organisation-id",
    label: "QA organisation",
    workItems: 4,
    comments: 5,
    attachments: 6,
    legalHold: "none",
    retention: "soft_deleted",
    impact: {
      organisations: 1,
      projects: 2,
      people: 3,
      workItems: 4,
      comments: 5,
      submissions: 6,
      attachments: 7,
      storageObjectsQueued: 8,
    },
  },
  confirmation: "typed_name_step_up",
  approvalSupported: true,
  state: "pending",
  origin: "web",
  expiresAt: "2026-10-27T00:00:00.000Z",
};

describe("application i18n provider and global approval dialog", () => {
  beforeEach(() => {
    mocks.action.mockReset().mockResolvedValue(organisationPurge);
    mocks.publicTerminology.mockReset().mockResolvedValue({
      locale: "en-US",
      audience: "agent",
      terms: {
        work_item: { one: "Case", other: "Cases" },
        project: { one: "Plan", other: "Plans" },
      },
      etag: "test-etag",
    });
    mocks.factorStatus.mockReset().mockResolvedValue({
      enabled: true,
      required: true,
      availableMethods: ["password"],
    });
    mocks.approve.mockReset();
    mocks.cancel.mockReset();
    mocks.proof.mockReset();
    mocks.navigate.mockReset();
    usePendingActionDialogStore.setState({ pendingActionId: "pa-org-purge" });
  });

  afterEach(() => {
    cleanup();
    usePendingActionDialogStore.setState({ pendingActionId: null });
  });

  it("translates the global dialog with agent instance terms, without raw placeholders", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AppI18nProvider>
          <PendingActionApprovalDialog />
        </AppI18nProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent("Plans: 2");
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Requests and Cases: 4",
      );
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveTextContent(/\{\{term_[^}]+\}\}/u);
    expect(mocks.publicTerminology).toHaveBeenCalledWith("en-US");
    expect(mocks.action).toHaveBeenCalledWith("pa-org-purge");
  });
});
