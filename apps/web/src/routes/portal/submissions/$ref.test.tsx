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
import { Route } from "./$ref";

const mocks = vi.hoisted(() => ({
  getSubmission: vi.fn(),
  getAttachments: vi.fn(),
  completeAttachment: vi.fn(),
  downloadAttachment: vi.fn(),
  presignAttachment: vi.fn(),
  reply: vi.fn(),
  withdraw: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ ref: "SUB-7" }),
  }),
}));

vi.mock("@/fetchers/intake", () => ({
  completePortalSubmissionAttachment: mocks.completeAttachment,
  downloadPortalSubmissionAttachment: mocks.downloadAttachment,
  getPortalSubmission: mocks.getSubmission,
  getPortalSubmissionAttachments: mocks.getAttachments,
  presignPortalSubmissionAttachment: mocks.presignAttachment,
  replyPortalSubmission: mocks.reply,
  withdrawPortalSubmission: mocks.withdraw,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; ref?: string }) =>
      (options?.defaultValue ?? _key).replace("{{ref}}", options?.ref ?? ""),
  }),
}));

const PortalSubmission = (Route as unknown as { component: ComponentType })
  .component;

const submission = {
  submission: {
    state: "new",
    formData: { title: "Password reset" },
    workItemId: null,
  },
  canWithdraw: true,
  workItem: null,
  requestType: { name: "Access request" },
  version: {
    formSchema: {
      fields: [{ key: "title", label: "Summary", type: "text" }],
    },
  },
  messages: [],
};

function renderSubmission() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PortalSubmission />
    </QueryClientProvider>,
  );
}

describe("portal submission route", () => {
  beforeEach(() => {
    mocks.getSubmission
      .mockReset()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue(submission);
    mocks.getAttachments.mockReset().mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("keeps a failed primary read out of the loaded page and retries it", async () => {
    renderSubmission();

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This request could not be loaded or updated.",
    );
    expect(
      screen.queryByRole("heading", { name: "Your answers" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send reply" }),
    ).not.toBeInTheDocument();

    fireEvent.click(retry);
    await waitFor(() => expect(mocks.getSubmission).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("heading", { name: "Your answers" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
  });

  it("shows no dangling separator in the header while loading, then the joined subtitle", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue(submission);
    const { container } = renderSubmission();
    expect(container.querySelector("header p")).toBeNull();
    expect(await screen.findByText("Access request · new")).toBeVisible();
  });
});
