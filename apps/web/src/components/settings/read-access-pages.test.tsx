import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  answer: vi.fn(),
  protectedRead: vi.fn(),
  reportCatalogue: vi.fn(),
  reportRead: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key.includes(":") ? key : `${namespace}:${key}`, options),
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/i18n", () => ({ i18n: { language: "en-US" } }));
vi.mock("@tanstack/react-router", () => ({
  Link: () => null,
  useRouter: () => ({
    history: { canGoBack: () => true, back: vi.fn() },
    navigate: vi.fn(),
  }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "user" } }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspaceSettings: () => false,
    canCreateSavedViews: () => false,
  }),
}));
vi.mock("@/components/reports/reports-feature-gate", () => ({
  ReportsFeatureGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/reports/report-filters", () => ({
  ReportFilters: () => {
    mocks.protectedRead();
    return null;
  },
  reportOrganisationChoices: () => [],
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/fetchers/service-management", async (original) => ({
  ...(await original<typeof import("@/fetchers/service-management")>()),
  getCatalogueStatus: mocks.answer,
}));
vi.mock("@/fetchers/announcements", async (original) => ({
  ...(await original<typeof import("@/fetchers/announcements")>()),
  listAnnouncements: mocks.protectedRead,
  getAnnouncementAudienceOptions: mocks.protectedRead,
}));
vi.mock("@/fetchers/saved-views", () => ({
  getSavedViews: mocks.protectedRead,
}));
vi.mock("@/fetchers/report", async (original) => ({
  ...(await original<typeof import("@/fetchers/report")>()),
  getReportCatalogue: mocks.reportCatalogue,
  getReport: mocks.reportRead,
}));

import { ReportsIndex } from "@/components/reports/reports-index";
import { AnnouncementsList } from "@/components/service-management/announcements-list";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.answer.mockImplementation(() => new Promise(() => {}));
  mocks.reportCatalogue.mockImplementation(mocks.answer);
  mocks.reportRead.mockImplementation(mocks.answer);
});
afterEach(cleanup);

// These pages use a data read as the access answer, rather than /api/capabilities.
describe.each([
  ["announcements", AnnouncementsList, "Announcements"],
  [
    "reports index",
    () => <ReportsIndex search={{}} onSearchChange={vi.fn()} />,
    "Reports",
  ],
] as const)("%s access answer", (name, Page, title) => {
  function mount(earlyRefusal = false) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 } },
    });
    if (earlyRefusal)
      client
        .getQueryCache()
        .build(client, {
          queryKey: ["service-management", "announcements", "ws"],
        })
        .setState({ status: "error", error: new HttpError(403, "Forbidden") });
    return render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    );
  }
  it.each(name === "announcements" ? [false, true] : [false])(
    "keeps one page heading through loading and failure (early refusal: %s), retries without protected reads",
    async (earlyRefusal) => {
      let fail!: (error: Error) => void;
      mocks.answer
        .mockReturnValueOnce(
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
        )
        .mockRejectedValue(new HttpError(500, "Unavailable"));
      const { container } = mount(earlyRefusal);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        title,
      );
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(mocks.protectedRead).not.toHaveBeenCalled();
      fail(new HttpError(500, "Unavailable"));
      const retry = await screen.findByRole("button", { name: "Retry" });
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        title,
      );
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(container.querySelector("form")).toBeNull();
      expect(mocks.protectedRead).not.toHaveBeenCalled();
      const reads = mocks.answer.mock.calls.length;
      mocks.answer.mockRejectedValue(new HttpError(403, "Forbidden"));
      fireEvent.click(retry);
      await waitFor(() =>
        expect(mocks.answer.mock.calls.length).toBeGreaterThan(reads),
      );
      await screen.findByRole("heading", {
        level: 1,
        name: "You don't have access",
      });
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(mocks.protectedRead).not.toHaveBeenCalled();
    },
  );
  it("shows only one shared heading when the answer denies access", async () => {
    mocks.answer.mockRejectedValue(new HttpError(403, "Forbidden"));
    mount();
    await screen.findByRole("heading", {
      level: 1,
      name: "You don't have access",
    });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(mocks.protectedRead).not.toHaveBeenCalled();
  });
});

it("announcements denies a successful status answer without management access", async () => {
  mocks.answer.mockResolvedValue({ enabled: true, canManageServices: false });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AnnouncementsList />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", {
    level: 1,
    name: "You don't have access",
  });
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(mocks.protectedRead).not.toHaveBeenCalled();
});
