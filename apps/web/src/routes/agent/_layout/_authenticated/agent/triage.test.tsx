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
    useSearch: () => ({ state: "new" }),
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
  default: () => ({ data: [], isLoading: false }),
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
    t: (key: string, options?: { defaultValue?: string; state?: string }) => {
      const value =
        key === "actionError"
          ? "The intake action failed or the submission changed. Reload the queue and try again."
          : (options?.defaultValue ?? key);
      return value.replace("{{state}}", options?.state ?? "");
    },
  }),
}));

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
});
