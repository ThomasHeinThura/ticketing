import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PendingActionApprovalDialog from "@/components/pending-action/pending-action-approval-dialog";
import usePendingActionDialogStore from "@/store/pending-action-dialog";
import { i18n } from "./index";
import { AppI18nProvider } from "./provider";

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  publicTerminology: vi.fn(),
  factorStatus: vi.fn(),
  approve: vi.fn(),
  cancel: vi.fn(),
  proof: vi.fn(),
  navigate: vi.fn(),
  locale: "en-US",
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { locale: mocks.locale } }),
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
    mocks.locale = "en-US";
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

  it("does not signal the current language again, but switches when the user locale changes", async () => {
    await i18n.changeLanguage("en-US");
    const change = vi.spyOn(i18n, "changeLanguage");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <AppI18nProvider>
          <span>Content</span>
        </AppI18nProvider>
      </QueryClientProvider>
    );
    const view = render(tree());
    expect(change).not.toHaveBeenCalled();
    mocks.locale = "fr-FR";
    view.rerender(tree());
    await waitFor(() => expect(i18n.language).toBe("fr-FR"));
    expect(change).toHaveBeenCalledWith("fr-FR");
    expect(document.documentElement.lang).toBe("fr-FR");
    view.unmount();
    change.mockRestore();
    await i18n.changeLanguage("en-US");
  });

  it("keeps English when the user switches back while French is loading", async () => {
    await i18n.changeLanguage("en-US");
    // Hold i18next's completion callback, retaining its real language-change race handling.
    const loader = i18n as unknown as {
      loadResources: (
        locale: string,
        callback: (error?: unknown) => void,
      ) => void;
    };
    const originalLoad = loader.loadResources.bind(i18n);
    let finishFrench: (() => void) | undefined;
    const load = vi
      .spyOn(loader, "loadResources")
      .mockImplementation((locale, callback) => {
        originalLoad(locale, (error) => {
          if (locale === "fr-FR") finishFrench = () => callback(error);
          else callback(error);
        });
      });
    const change = vi.spyOn(i18n, "changeLanguage");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <AppI18nProvider>
          <span>Content</span>
        </AppI18nProvider>
      </QueryClientProvider>
    );
    const view = render(tree());
    mocks.locale = "fr-FR";
    view.rerender(tree());
    await waitFor(() => expect(finishFrench).toBeDefined());
    expect(i18n.language).toBe("en-US");
    mocks.locale = "en-US";
    view.rerender(tree());
    await waitFor(() => expect(change).toHaveBeenCalledWith("en-US"));
    await act(async () => {
      finishFrench?.();
    });
    expect(i18n.language).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
    view.unmount();
    load.mockRestore();
    change.mockRestore();
  });
});
