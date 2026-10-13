import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./triage";

const mocks = vi.hoisted(() => ({
  search: { state: "new" } as { state: string; ref?: string },
  workItemTypes: [] as Array<{ id: string; name: string }>,
  navigate: vi.fn(),
  getSubmissions: vi.fn(),
  acceptSubmission: vi.fn(),
  askClarification: vi.fn(),
  claimSubmission: vi.fn(),
  declineSubmission: vi.fn(),
  downloadAttachment: vi.fn(),
  getDuplicateSuggestions: vi.fn(),
  getSubmission: vi.fn(),
  getSubmissionAttachments: vi.fn(),
  markDuplicate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/fetchers/intake", () => ({
  acceptSubmission: mocks.acceptSubmission,
  askSubmissionClarification: mocks.askClarification,
  claimSubmission: mocks.claimSubmission,
  declineSubmission: mocks.declineSubmission,
  downloadSubmissionAttachment: mocks.downloadAttachment,
  getDuplicateSuggestions: mocks.getDuplicateSuggestions,
  getSubmission: mocks.getSubmission,
  getSubmissionAttachments: mocks.getSubmissionAttachments,
  getSubmissions: mocks.getSubmissions,
  markSubmissionDuplicate: mocks.markDuplicate,
}));

vi.mock("@/hooks/queries/work-item/use-get-work-item-types", () => ({
  default: () => ({ data: mocks.workItemTypes, isLoading: false }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" }, isLoading: false }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: { defaultValue?: string; state?: string; [k: string]: unknown },
    ) => {
      const value =
        key === "actionError"
          ? "The intake action failed or the submission changed. Reload the queue and try again."
          : (options?.defaultValue ?? key);
      return value.replace(/\{\{(\w+)\}\}/gu, (_match, name: string) =>
        String((options as Record<string, unknown> | undefined)?.[name] ?? ""),
      );
    },
  }),
}));

function detail(state: string, claimedAt: string | null, workItemId?: string) {
  return {
    submission: { state, formData: {}, claimedAt, workItemId },
    requestType: { name: "Access request" },
    version: {
      defaultProjectId: "project-1",
      workItemTypeId: "type-opaque-id",
      formSchema: { fields: [] },
    },
    messages: [],
  };
}

const IntakeRoute = (Route as unknown as { component: ComponentType })
  .component;

function renderTriage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntakeRoute />
    </QueryClientProvider>,
  );
}

describe("intake triage route", () => {
  beforeEach(() => {
    mocks.search = { state: "new" };
    mocks.workItemTypes = [];
    mocks.navigate.mockReset();
    mocks.getSubmissions
      .mockReset()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue({
        submissions: [
          {
            ref: "SUB-7",
            summary: "A new request",
            submission: { state: "new", createdAt: "2026-10-01T00:00:00Z" },
            requestType: { name: "Access request" },
            requester: { displayName: "Ada" },
            organisation: { name: "Northstar" },
          },
        ],
        page: { hasMore: false, nextCursor: null },
      });
  });

  afterEach(() => cleanup());

  it("keeps a failed queue distinct from empty and offers retry", async () => {
    renderTriage();

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The intake action failed or the submission changed. Reload the queue and try again.",
    );
    expect(
      screen.queryByText("New customer requests will appear here."),
    ).not.toBeInTheDocument();

    fireEvent.click(retry);
    await waitFor(() => expect(mocks.getSubmissions).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("SUB-7")).toBeVisible();
    expect(
      screen.queryByText("New customer requests will appear here."),
    ).not.toBeInTheDocument();
  });

  it("exposes the selected status filter and the open row to assistive technology", async () => {
    mocks.getSubmissions.mockReset().mockResolvedValue({
      submissions: [
        {
          ref: "SUB-7",
          summary: "A new request",
          submission: { state: "new", createdAt: "2026-10-01T00:00:00Z" },
          requestType: { name: "Access request" },
          requester: { displayName: "Ada" },
          organisation: { name: "Northstar" },
        },
      ],
      page: { hasMore: false, nextCursor: null },
    });
    mocks.search = { state: "new", ref: "SUB-7" };
    mocks.getSubmission.mockResolvedValue(detail("new", null));
    mocks.getSubmissionAttachments.mockResolvedValue([]);
    mocks.getDuplicateSuggestions.mockResolvedValue({ suggestions: [] });
    renderTriage();

    expect(
      await screen.findByRole("button", { name: "new", pressed: true }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "accepted", pressed: false }),
    ).toBeVisible();
    const row = await screen.findByRole("button", { name: /SUB-7/u });
    expect(row).toHaveAttribute("aria-current", "true");
  });

  it("shows the work item type name instead of its id, and claim feedback with focus", async () => {
    mocks.getSubmissions.mockReset().mockResolvedValue({
      submissions: [],
      page: { hasMore: false, nextCursor: null },
    });
    mocks.search = { state: "new", ref: "SUB-7" };
    mocks.workItemTypes = [{ id: "type-opaque-id", name: "Service request" }];
    mocks.getSubmission
      .mockReset()
      .mockResolvedValueOnce(detail("new", null))
      .mockResolvedValue(detail("new", "2026-10-02T10:00:00Z"));
    mocks.getSubmissionAttachments.mockResolvedValue([]);
    mocks.getDuplicateSuggestions.mockResolvedValue({ suggestions: [] });
    mocks.claimSubmission.mockReset().mockResolvedValue({});
    renderTriage();

    expect(
      await screen.findByText("Prefilled from request type: Service request"),
    ).toBeVisible();
    expect(screen.queryByText(/type-opaque-id/u)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "claim" }));
    expect(await screen.findByText(/^Claimed /u)).toBeVisible();
    const status = screen.getByRole("status");
    await waitFor(() => expect(document.activeElement).toBe(status));
  });

  it("names the converted work item and keeps focus on the status after Accept", async () => {
    mocks.getSubmissions.mockReset().mockResolvedValue({
      submissions: [],
      page: { hasMore: false, nextCursor: null },
    });
    mocks.search = { state: "new", ref: "SUB-7" };
    mocks.getSubmission
      .mockReset()
      .mockResolvedValueOnce(detail("new", null))
      .mockResolvedValue(detail("accepted", null, "raw-work-item-id"));
    mocks.getSubmissionAttachments.mockResolvedValue([]);
    mocks.getDuplicateSuggestions.mockResolvedValue({ suggestions: [] });
    mocks.acceptSubmission.mockReset().mockResolvedValue({
      state: "accepted",
      workItem: { key: "WI-12", title: "Need account access" },
    });
    renderTriage();

    fireEvent.click(await screen.findByRole("button", { name: "accept" }));
    expect(
      await screen.findByText(
        "Converted work item: WI-12 · Need account access",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/raw-work-item-id/u)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("status")),
    );
  });

  it("lets the destination selects shrink inside a narrow detail panel", async () => {
    mocks.getSubmissions.mockReset().mockResolvedValue({
      submissions: [],
      page: { hasMore: false, nextCursor: null },
    });
    mocks.search = { state: "new", ref: "SUB-7" };
    mocks.getSubmission.mockReset().mockResolvedValue(detail("new", null));
    mocks.getSubmissionAttachments.mockResolvedValue([]);
    mocks.getDuplicateSuggestions.mockResolvedValue({ suggestions: [] });
    renderTriage();
    // jsdom has no layout: assert the class contract measured in Chromium at
    // 375 px (a flex child with min-width:auto would grow to its select text).
    for (const name of ["Destination project", "Work item type"]) {
      const trigger = await screen.findByRole("combobox", { name });
      const wrapper = trigger.closest("div.flex-col") as HTMLElement;
      expect(wrapper.className).toContain("min-w-0");
      expect(wrapper.className).toContain("max-w-full");
    }
  });
});
