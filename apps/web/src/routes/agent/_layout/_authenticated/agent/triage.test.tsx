import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./triage";

const mocks = vi.hoisted(() => ({
  search: { state: "new" } as {
    state: string;
    ref?: string;
    assignee?: string;
    age?: string;
    requestType?: string;
  },
  workItemTypes: [] as Array<{ id: string; name: string }>,
  navigate: vi.fn(),
  getSubmissions: vi.fn(),
  acceptSubmission: vi.fn(),
  askClarification: vi.fn(),
  claimSubmission: vi.fn(),
  declineSubmission: vi.fn(),
  downloadAttachment: vi.fn(),
  getDuplicateSuggestions: vi.fn(),
  getRequestTypes: vi.fn(),
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
  getRequestTypes: mocks.getRequestTypes,
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
    mocks.getRequestTypes.mockReset().mockResolvedValue({
      requestTypes: [
        { id: "rt_1", key: "access", name: "Access request" },
        { id: "rt_2", key: "vpn", name: "VPN" },
      ],
    });
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

  it("shows the submission age and asks the server to apply the URL filters", async () => {
    const hoursAgo = (hours: number) =>
      new Date(Date.now() - hours * 3_600_000).toISOString();
    mocks.getSubmissions.mockReset().mockResolvedValue({
      submissions: [
        {
          ref: "SUB-1",
          summary: "Old one",
          submission: {
            state: "new",
            createdAt: hoursAgo(5 * 24),
            claimedBy: null,
          },
          requestType: { id: "rt_1", name: "Access request" },
          requester: { displayName: "Ada" },
          organisation: { name: "Northstar" },
        },
        {
          ref: "SUB-2",
          summary: "Fresh claimed",
          submission: { state: "new", createdAt: hoursAgo(2), claimedBy: "p1" },
          requestType: { id: "rt_2", name: "VPN" },
          requester: { displayName: "Bo" },
          organisation: { name: "Northstar" },
        },
      ],
      page: { hasMore: false, nextCursor: null },
    });
    mocks.search = { state: "new" };
    const first = renderTriage();
    await screen.findByText("SUB-1");
    expect(
      screen.getAllByTestId("triage-row-age").map((cell) => cell.textContent),
    ).toEqual(["5d", "2h"]);
    first.unmount();

    mocks.getSubmissions.mockReset().mockResolvedValue({
      submissions: [
        {
          ref: "SUB-1",
          summary: "Old one",
          submission: {
            state: "new",
            createdAt: hoursAgo(5 * 24),
            claimedBy: null,
          },
          requestType: { id: "rt_1", name: "Access request" },
          requester: { displayName: "Ada" },
          organisation: { name: "Northstar" },
        },
      ],
      page: { hasMore: false, nextCursor: null },
    });
    mocks.search = {
      state: "new",
      assignee: "unclaimed",
      age: "3d",
      requestType: "rt_1",
    };
    renderTriage();
    await screen.findByText("SUB-1");
    // IQ-21: the server applies request type key, assignee and age; not the page.
    await waitFor(() =>
      expect(mocks.getSubmissions).toHaveBeenCalledWith(
        expect.anything(),
        "new",
        undefined,
        { requestTypeKey: "access", assignee: "unclaimed", olderThanDays: 3 },
      ),
    );
    const chips = screen.getByTestId("triage-filter-chips");
    expect(within(chips).getByText("Unclaimed")).toBeVisible();
    fireEvent.click(
      within(chips).getByRole("button", { name: "Remove Age filter" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      search: expect.objectContaining({ age: undefined, cursor: undefined }),
    });
  });

  it("still narrows the loaded page for the claimed filter, which the server has no parameter for", async () => {
    const now = new Date().toISOString();
    const row = (ref: string, claimedBy: string | null) => ({
      ref,
      summary: `Summary of ${ref}`,
      submission: { state: "new", createdAt: now, claimedBy },
      requestType: { id: "rt_1", name: "Access request" },
      requester: { displayName: "Ada" },
      organisation: { name: "Northstar" },
    });
    mocks.getSubmissions.mockReset().mockResolvedValue({
      submissions: [row("SUB-1", null), row("SUB-2", "p1")],
      page: { hasMore: false, nextCursor: null },
    });
    mocks.search = { state: "new", assignee: "claimed" };
    renderTriage();
    await screen.findByText("Summary of SUB-2");
    expect(screen.queryByText("Summary of SUB-1")).not.toBeInTheDocument();
    expect(mocks.getSubmissions).toHaveBeenCalledWith(
      expect.anything(),
      "new",
      undefined,
      {},
    );
  });

  it("offers every request type in the filter menu and navigates with the choice", async () => {
    mocks.getSubmissions.mockReset().mockResolvedValue({
      submissions: [],
      page: { hasMore: false, nextCursor: null },
    });
    renderTriage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Filter queue" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Request type" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "VPN" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      search: expect.objectContaining({ requestType: "rt_2" }),
    });
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

    const filter = screen.getByRole("button", {
      name: "Submission status filter",
    });
    expect(filter).toHaveTextContent("Status: new");
    fireEvent.click(filter);
    expect(
      await screen.findByRole("menuitemcheckbox", { name: "new" }),
    ).toHaveAttribute("aria-checked", "true");
    const accepted = screen.getByRole("menuitemcheckbox", { name: "accepted" });
    expect(accepted).toHaveAttribute("aria-checked", "false");
    fireEvent.click(accepted);
    expect(mocks.navigate).toHaveBeenCalledWith({
      search: { state: "accepted", ref: "SUB-7", cursor: undefined },
    });
    const row = await screen.findByRole("button", { name: /SUB-7/u });
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row.closest("tr")).toHaveAttribute("data-state", "selected");
    const table = screen.getByRole("table", { name: "title" });
    expect(
      within(table).getByRole("columnheader", { name: "Summary" }),
    ).toBeVisible();
    expect(
      within(table).getByRole("cell", { name: "A new request" }),
    ).toBeVisible();
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
