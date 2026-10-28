import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./$ref";

const mocks = vi.hoisted(() => ({
  getSubmission: vi.fn(),
  getAttachments: vi.fn(),
  completeAttachment: vi.fn(),
  downloadAttachment: vi.fn(),
  previewPath: vi.fn(
    (ref: string, id: string) =>
      `/portal/submissions/${encodeURIComponent(ref)}/attachments/${encodeURIComponent(id)}/preview`,
  ),
  downloadPath: vi.fn(
    (ref: string, id: string) =>
      `/portal/submissions/${encodeURIComponent(ref)}/attachments/${encodeURIComponent(id)}`,
  ),
  presignAttachment: vi.fn(),
  reply: vi.fn(),
  withdraw: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useRouteContext: () => ({ portalUserId: "customer-a" }),
    useParams: () => ({ ref: "SUB-7" }),
  }),
  useLocation: () => ({ hash: window.location.hash }),
}));

vi.mock("@/fetchers/intake", () => ({
  completePortalSubmissionAttachment: mocks.completeAttachment,
  downloadPortalSubmissionAttachment: mocks.downloadAttachment,
  portalSubmissionAttachmentDownloadPath: mocks.downloadPath,
  portalSubmissionAttachmentPreviewPath: mocks.previewPath,
  getPortalSubmission: mocks.getSubmission,
  getPortalSubmissionAttachments: mocks.getAttachments,
  presignPortalSubmissionAttachment: mocks.presignAttachment,
  replyPortalSubmission: mocks.reply,
  withdrawPortalSubmission: mocks.withdraw,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: "en", language: "en" },
    t: (_key: string, options?: { defaultValue?: string; ref?: string }) =>
      (options?.defaultValue ?? _key).replace("{{ref}}", options?.ref ?? ""),
  }),
}));

vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; ref?: string }) =>
      (options?.defaultValue ?? _key).replace("{{ref}}", options?.ref ?? ""),
  }),
}));

vi.mock("@/lib/i18n/terminology-provider", () => ({
  TerminologyProvider: ({ children }: { children: ReactNode }) => children,
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
    window.history.replaceState({}, "", "/submissions/SUB-7");
    mocks.previewPath.mockClear();
    mocks.downloadPath.mockClear();
    mocks.getSubmission
      .mockReset()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue({
        ...submission,
        submission: { ...submission.submission, state: "clarifying" },
      });
    mocks.getAttachments.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/submissions/SUB-7");
  });

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

  it("P2R1-05: shows the auto-decline as a system message, never as staff or a colleague", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue({
      ...submission,
      messages: [
        {
          id: "system-1",
          actorType: "system",
          authorName: null,
          mine: false,
          body: "No reply was received within 14 days.",
          reasonCode: "clarification_window_expired",
          reasonParams: { days: 14 },
          createdAt: "2026-10-26T10:00:00.000Z",
        },
      ],
    });
    renderSubmission();
    const body = await screen.findByText(
      "No reply was received within 14 days.",
    );
    const item = body.closest("li");
    expect(item?.textContent).toContain("portal:request.author.system");
    expect(item?.textContent).not.toContain("request.author.team");
  });

  it("scrolls to and focuses the exact public comment from a notification link", async () => {
    window.history.replaceState(
      {},
      "",
      "/submissions/SUB-7#comment-public-comment-1",
    );
    mocks.getSubmission.mockReset().mockResolvedValue({
      ...submission,
      messages: [
        {
          id: "public-comment-1",
          actorType: "triager",
          authorName: null,
          body: "A public update",
          createdAt: "2026-10-26T10:00:00.000Z",
        },
      ],
    });
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;

    renderSubmission();

    const target = await screen.findByText("A public update");
    const item = target.closest("li");
    expect(item).toHaveAttribute("id", "comment-public-comment-1");
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(item));
  });

  it("shows customer-visible custom fields as label and value on an accepted request (CF-11)", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue({
      ...submission,
      submission: { ...submission.submission, state: "accepted" },
      workItem: {
        title: "Password reset",
        description: "",
        priority: null,
        resolvedAt: null,
        sla: null,
      },
      customFields: [
        {
          key: "order_no",
          label: "Order number",
          format: "text",
          value: "ORD-1",
        },
        {
          key: "tags",
          label: "Affects",
          format: "multi_select",
          value: ["Email", "VPN"],
        },
        {
          key: "urgent",
          label: "Needs a call",
          format: "boolean",
          value: true,
        },
      ],
    });
    renderSubmission();
    expect(await screen.findByText("Order number")).toBeVisible();
    expect(screen.getByText("ORD-1")).toBeVisible();
    expect(screen.getByText("Email, VPN")).toBeVisible();
    expect(screen.getByText("Needs a call")).toBeVisible();
    expect(screen.getByText("Yes")).toBeVisible();
  });

  it("shows no dangling separator in the header while loading, then the joined subtitle", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue(submission);
    const { container } = renderSubmission();
    expect(container.querySelector("header p")).toBeNull();
    expect(await screen.findByText("Access request · new")).toBeVisible();
  });

  it("offers the reply box only where the API accepts a reply (clarifying, accepted)", async () => {
    for (const [state, visible] of [
      ["new", false],
      ["duplicate", false],
      ["declined", false],
      ["withdrawn", false],
      ["clarifying", true],
      ["accepted", true],
    ] as const) {
      mocks.getSubmission.mockReset().mockResolvedValue({
        ...submission,
        submission: { ...submission.submission, state },
        workItem:
          state === "accepted"
            ? { title: "T", description: "", state: "open", priority: null }
            : null,
      });
      const view = renderSubmission();
      await screen.findByText(/Access request ·/u);
      expect(
        screen.queryByRole("button", { name: "Send reply" }) !== null,
        state,
      ).toBe(visible);
      view.unmount();
    }
  });

  it("downloads under the file name and shows an error when the download fails", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue(submission);
    mocks.getAttachments
      .mockReset()
      .mockResolvedValue([
        { id: "att-1", filename: "evidence.png", size: 2048, state: "ready" },
      ]);
    mocks.downloadAttachment
      .mockReset()
      .mockRejectedValueOnce(new Error("Unable to download attachment"))
      .mockResolvedValue(undefined);
    renderSubmission();

    fireEvent.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(mocks.downloadAttachment).toHaveBeenCalledWith({
        ref: "SUB-7",
        id: "att-1",
        filename: "evidence.png",
      }),
    );
    expect(
      await screen.findByText("The file could not be downloaded. Try again."),
    ).toBeVisible();
  });

  it("previews ready PDFs through the portal route and leaves Office download-only", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue(submission);
    mocks.getAttachments.mockReset().mockResolvedValue([
      {
        id: "pdf/1",
        filename: "evidence.pdf",
        mimeType: "application/pdf",
        size: 512,
        state: "ready",
      },
      {
        id: "doc-1",
        filename: "notes.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 512,
        state: "ready",
      },
    ]);
    renderSubmission();

    const preview = await screen.findByRole("button", {
      name: "workItems:detail.attachments.pdfPreviewOpen",
    });
    expect(
      screen.queryByRole("button", { name: /pdfPreviewOpen.*notes/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(2);
    fireEvent.click(preview);
    expect(
      await screen.findByTitle("workItems:detail.attachments.pdfPreviewTitle"),
    ).toHaveAttribute("src", "/pdf-preview.html");
    expect(mocks.previewPath).toHaveBeenCalledWith("SUB-7", "pdf/1");
    expect(mocks.downloadPath).toHaveBeenCalledWith("SUB-7", "pdf/1");
  });
});
