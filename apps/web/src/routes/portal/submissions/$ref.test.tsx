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
import { HttpError } from "@/lib/http-error";
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
  Link: ({ children, to, ...props }: { children?: unknown; to: string }) => (
    <a href={to} {...(props as object)}>
      {children as never}
    </a>
  ),
  useLocation: () => ({ hash: window.location.hash }),
}));

vi.mock("@/components/portal/requests/portal-submission-fetch", () => ({
  getPortalSubmissionDetail: mocks.getSubmission,
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
    // A transient failure is retried twice before the page offers its own Retry.
    mocks.getSubmission
      .mockReset()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue({
        ...submission,
        submission: { ...submission.submission, state: "clarifying" },
      });
    renderSubmission();

    const retry = await screen.findByRole(
      "button",
      { name: "Retry" },
      { timeout: 6000 },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This request could not be loaded or updated.",
    );
    expect(
      screen.queryByRole("heading", { name: "Your answers" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "intake.sendReply" }),
    ).not.toBeInTheDocument();

    fireEvent.click(retry);
    await waitFor(() => expect(mocks.getSubmission).toHaveBeenCalledTimes(4));
    expect(
      await screen.findByRole("heading", { name: "Your answers" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "intake.sendReply" }),
    ).toBeDisabled();
  });

  it("says a missing or foreign submission is not found, with a way back, and does not retry", async () => {
    mocks.getSubmission
      .mockReset()
      .mockRejectedValue(new HttpError(404, "Submission not found"));
    renderSubmission();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "portal:requestPage.notFound.title",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "portal:requestPage.back" }),
    ).toHaveAttribute("href", "/requests");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.getSubmission).toHaveBeenCalledTimes(1);
  });

  it("reads like the request page: back link, title and reference, details card, portal dates and sizes", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue({
      ...submission,
      submission: {
        ...submission.submission,
        state: "accepted",
        createdAt: "2026-10-31T19:55:13.000Z",
      },
      customerStatus: "in_progress",
      workItem: {
        title: "VPN drops every 10 minutes",
        description: "",
        state: "open",
        priority: "urgent",
      },
      messages: [
        {
          id: "m1",
          actorType: "triager",
          authorName: "Sam",
          mine: false,
          body: "Looking now",
          reasonCode: null,
          reasonParams: null,
          createdAt: "2026-10-31T19:55:13.000Z",
        },
      ],
    });
    mocks.getAttachments.mockReset().mockResolvedValue([
      {
        id: "f1",
        filename: "audit.txt",
        mimeType: "text/plain",
        size: 46,
        state: "ready",
        downloadable: true,
      },
    ]);
    const { container } = renderSubmission();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "VPN drops every 10 minutes",
      }),
    ).toBeVisible();
    expect(screen.getByText("SUB-7")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "portal:requestPage.back" }),
    ).toBeVisible();
    // Severity (not "Priority"), from the same badge as the case list.
    expect(screen.getByText("portal:cases.columns.severity")).toBeVisible();
    expect(screen.queryByText("portal:request.priority.label")).toBeNull();
    const expected = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date("2026-10-31T19:55:13.000Z"));
    expect(screen.getByText(/^Sam ·/u)).toHaveTextContent(`Sam · ${expected}`);
    expect(container.textContent).not.toContain(
      new Date("2026-10-31T19:55:13.000Z").toLocaleString(),
    );
    // 46 B reads as 46 B, and a ready file never says "ready".
    expect(await screen.findByText("46 B")).toBeVisible();
    expect(container.textContent).not.toMatch(/1 KB|· ready/u);
    // The shell owns the page's <main> landmark.
    expect(container.querySelector("main")).toBeNull();
    expect(document.title).toBe(
      "VPN drops every 10 minutes · SUB-7 · navigation.title",
    );
  });

  it("moves focus to the reply just sent when replying closes the reply box (IQ-13)", async () => {
    const message = {
      id: "m9",
      actorType: "customer",
      authorName: null,
      mine: true,
      body: "Here is the detail",
      reasonCode: null,
      reasonParams: null,
      createdAt: "2026-11-03T10:00:00.000Z",
    };
    mocks.getSubmission
      .mockReset()
      .mockResolvedValueOnce({
        ...submission,
        submission: { ...submission.submission, state: "clarifying" },
      })
      // The reply returns the request to the team: no reply box any more.
      .mockResolvedValue({ ...submission, messages: [message] });
    mocks.reply.mockReset().mockResolvedValue({ message: { id: "m9" } });
    renderSubmission();
    const box = await screen.findByLabelText("intake.reply");
    fireEvent.change(box, { target: { value: "Here is the detail" } });
    fireEvent.click(screen.getByRole("button", { name: "intake.sendReply" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.getElementById("comment-m9"),
      ),
    );
    expect(screen.queryByLabelText("intake.reply")).toBeNull();
    expect(
      screen
        .getAllByRole("status")
        .some((node) => node.textContent === "portal:requestPage.replySent"),
    ).toBe(true);
  });

  it("shows a severity only once the team has the request, never 'Not set' for the customer's own choice", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue(submission);
    renderSubmission();
    await screen.findByRole("heading", { level: 1, name: "Access request" });
    expect(screen.queryByText("portal:cases.columns.severity")).toBeNull();
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

  it("shows a loading state without a header, then the title, reference and status", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue(submission);
    const { container } = renderSubmission();
    expect(container.querySelector("header")).toBeNull();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Access request" }),
    ).toBeVisible();
    expect(screen.getByText("SUB-7")).toBeVisible();
    // The request type is the title here, so no subtitle repeats it.
    expect(container.querySelector("header p")).toBeNull();
    expect(screen.getByText("new")).toBeVisible();
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
      await screen.findByRole("heading", { level: 1 });
      expect(
        screen.queryByRole("button", { name: "intake.sendReply" }) !== null,
        state,
      ).toBe(visible);
      view.unmount();
    }
  });

  it("sends an accepted request's reply with its files, each attached to that reply (A-08)", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue({
      ...submission,
      submission: { ...submission.submission, state: "accepted" },
      workItem: { title: "T", description: "", state: "open", priority: null },
    });
    mocks.reply.mockReset().mockResolvedValue({ message: { id: "reply-1" } });
    mocks.presignAttachment.mockReset().mockResolvedValue({
      attachmentId: "file-1",
      uploadUrl: "/api/storage/portal-attachment-upload?key=k",
      uploadHeaders: { "Content-Type": "application/pdf" },
    });
    mocks.completeAttachment.mockReset().mockResolvedValue({ id: "file-1" });
    const put = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    renderSubmission();
    await screen.findByRole("heading", { level: 1 });
    // Once accepted, files go with a reply rather than a separate upload control.
    const picker = screen.getByLabelText("requestPage.attach");
    const file = new File(["%PDF-1.4"], "logs.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(picker, { target: { files: [file] } });
    expect(
      screen.getByRole("list", { name: "requestPage.filesToSend" }),
    ).toHaveTextContent("logs.pdf");
    fireEvent.change(screen.getByLabelText("intake.reply"), {
      target: { value: "Logs attached" },
    });
    fireEvent.click(screen.getByRole("button", { name: "intake.sendReply" }));
    await waitFor(() =>
      expect(mocks.completeAttachment).toHaveBeenCalledWith({
        ref: "SUB-7",
        id: "file-1",
      }),
    );
    expect(mocks.reply).toHaveBeenCalledWith({
      ref: "SUB-7",
      body: "Logs attached",
    });
    expect(mocks.presignAttachment).toHaveBeenCalledWith({
      ref: "SUB-7",
      commentId: "reply-1",
      filename: "logs.pdf",
      contentType: "application/pdf",
      size: file.size,
    });
    expect(put).toHaveBeenCalledWith(
      "/api/storage/portal-attachment-upload?key=k",
      expect.objectContaining({ method: "PUT", body: file }),
    );
    put.mockRestore();
  });

  it("downloads under the file name and shows an error when the download fails", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue(submission);
    mocks.getAttachments.mockReset().mockResolvedValue([
      {
        id: "att-1",
        filename: "evidence.png",
        size: 2048,
        state: "ready",
        downloadable: true,
      },
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
        downloadable: true,
      },
      {
        id: "doc-1",
        filename: "notes.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 512,
        state: "ready",
        downloadable: true,
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

  it("lists a team file the portal cannot serve without any download, even in the preview (CP-19)", async () => {
    mocks.getSubmission.mockReset().mockResolvedValue(submission);
    mocks.getAttachments.mockReset().mockResolvedValue([
      {
        id: "guide-1",
        filename: "vpn-guide.pdf",
        mimeType: "application/pdf",
        size: 512,
        state: "ready",
        downloadable: false,
      },
    ]);
    mocks.downloadPath.mockClear();
    renderSubmission();

    const preview = await screen.findByRole("button", {
      name: "workItems:detail.attachments.pdfPreviewOpen",
    });
    expect(screen.getByText(/vpn-guide\.pdf/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    // The missing Download is explained next to the file.
    expect(
      screen.getByText("portal:requestPage.fileNotDownloadable"),
    ).toBeVisible();
    fireEvent.click(preview);
    expect(
      await screen.findByTitle("workItems:detail.attachments.pdfPreviewTitle"),
    ).toHaveAttribute("src", "/pdf-preview.html");
    expect(mocks.downloadPath).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("link", { name: /pdfPreviewDownload/u }),
    ).toBeNull();
  });
});
