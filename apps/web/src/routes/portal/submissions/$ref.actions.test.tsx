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
import { PortalActionError } from "@/lib/portal-request";
import { translate } from "@/test/en-translation";
import { Route } from "./$ref";

/** A due time that is still in the future but never rolls past local midnight, so "today" holds at any hour. */
function dueLaterToday() {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 0);
  return new Date(Math.min(Date.now() + 3_600_000, endOfToday.getTime()));
}

const mocks = vi.hoisted(() => ({
  getSubmission: vi.fn(),
  getAttachments: vi.fn(),
  escalate: vi.fn(),
  reopen: vi.fn(),
  rate: vi.fn(),
  presign: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useRouteContext: () => ({ portalUserId: "customer-a" }),
    useParams: () => ({ ref: "SUB-7" }),
  }),
  useLocation: () => ({ hash: "" }),
}));

vi.mock("@/fetchers/intake", () => ({
  completePortalSubmissionAttachment: mocks.complete,
  downloadPortalSubmissionAttachment: vi.fn(),
  getPortalSubmission: mocks.getSubmission,
  getPortalSubmissionAttachments: mocks.getAttachments,
  presignPortalSubmissionAttachment: mocks.presign,
  replyPortalSubmission: vi.fn(),
  withdrawPortalSubmission: vi.fn(),
}));

vi.mock("@/fetchers/portal-request-actions", () => ({
  escalatePortalSubmissionPriority: mocks.escalate,
  reopenPortalSubmission: mocks.reopen,
  ratePortalSubmission: mocks.rate,
}));

// Resolve real English copy so the tests read what a customer reads.
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => {
    const i18n = {
      language: "en-US",
      resolvedLanguage: "en-US",
      t: (_key: string, options?: { count?: number }) =>
        translate(
          `term:customer.request_${options?.count === 1 ? "one" : "other"}`,
        ),
    };
    return {
      i18n,
      t: (key: string, options?: Record<string, unknown>) =>
        translate(key.includes(":") ? key : `portal:${key}`, options),
    };
  },
}));

const PortalSubmission = (Route as unknown as { component: ComponentType })
  .component;
const reopenRequestLabel = translate("portal:request.reopen.action");
const reopenPendingMessage = translate(
  "portal:request.errors.reopen_pending_review",
);

const accepted = {
  submission: { state: "accepted", formData: {}, workItemId: "wi-1" },
  isRequester: true,
  canWithdraw: false,
  canEscalate: true,
  workItem: {
    title: "Laptop replacement",
    description: "",
    state: "In progress",
    priority: "medium",
    sla: {
      state: "at_risk",
      dueAt: dueLaterToday().toISOString(),
    },
  },
  requestType: { name: "Hardware" },
  version: { formSchema: { fields: [] } },
  messages: [
    {
      id: "m1",
      actorType: "customer",
      mine: true,
      authorName: null,
      body: "Hello",
      createdAt: "2026-10-21T10:00:00Z",
    },
    {
      id: "m2",
      actorType: "triager",
      mine: false,
      authorName: "Sam Lee",
      body: "On it",
      createdAt: "2026-10-21T11:00:00Z",
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PortalSubmission />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getSubmission.mockReset().mockResolvedValue(accepted);
  mocks.getAttachments.mockReset().mockResolvedValue([]);
  mocks.escalate.mockReset().mockResolvedValue(accepted);
  mocks.reopen.mockReset().mockResolvedValue(accepted);
  mocks.rate.mockReset().mockResolvedValue(accepted);
});
afterEach(() => cleanup());

describe("customer wording and service target (CP-4, CP-5, CP-6, CP-10)", () => {
  it("never discloses the conversion or staff roles, and shows the due time in plain language", async () => {
    const { container } = renderPage();
    expect(await screen.findByText("Laptop replacement")).toBeVisible();
    expect(await screen.findByText("Due soon")).toBeVisible();
    expect(screen.getByText(/Resolution due by .* today/u)).toBeVisible();
    expect(screen.getByText(/^You ·/u)).toBeVisible();
    expect(screen.getByText(/^Sam Lee ·/u)).toBeVisible();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/work item|triager|assignee/iu);
    expect(screen.getByText("Medium")).toBeVisible();
  });
});

describe("raise priority (CP-7)", () => {
  it("offers only higher priorities and sends the chosen one", async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Raise priority" }),
    );
    expect(await screen.findByRole("button", { name: "High" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Urgent" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Low" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Medium" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Urgent" }));
    await waitFor(() =>
      expect(mocks.escalate).toHaveBeenCalledWith({
        ref: "SUB-7",
        priority: "urgent",
      }),
    );
  });

  it("is hidden at the top priority and when the server says no", async () => {
    mocks.getSubmission.mockResolvedValue({
      ...accepted,
      workItem: { ...accepted.workItem, priority: "urgent" },
    });
    const top = renderPage();
    await screen.findByText("Laptop replacement");
    expect(
      screen.queryByRole("button", { name: "Raise priority" }),
    ).not.toBeInTheDocument();
    top.unmount();
    mocks.getSubmission.mockResolvedValue({
      ...accepted,
      canEscalate: false,
    });
    renderPage();
    await screen.findByText("Laptop replacement");
    expect(
      screen.queryByRole("button", { name: "Raise priority" }),
    ).not.toBeInTheDocument();
  });

  it("shows a plain message for a coded refusal, never the server text", async () => {
    mocks.escalate.mockRejectedValue(
      new PortalActionError(403, "cannot_deescalate: internal queue detail"),
    );
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Raise priority" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "High" }));
    expect(
      await screen.findByText("You can only raise the priority, not lower it."),
    ).toBeVisible();
    expect(
      screen.queryByText(/internal queue detail/u),
    ).not.toBeInTheDocument();
  });
});

describe("reopen (CP-8)", () => {
  it("shows Reopen only when the server marks the request reopenable", async () => {
    const closed = {
      ...accepted,
      submission: { ...accepted.submission, state: "declined" },
      workItem: null,
    };
    mocks.getSubmission.mockResolvedValue(closed);
    const hidden = renderPage();
    await screen.findByText(/Hardware ·/u);
    expect(
      screen.queryByRole("button", { name: "Reopen request" }),
    ).not.toBeInTheDocument();
    hidden.unmount();

    mocks.getSubmission.mockResolvedValue({ ...closed, canReopen: true });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: reopenRequestLabel }),
    );
    await waitFor(() => expect(mocks.reopen).toHaveBeenCalledWith("SUB-7"));
  });

  it("explains a closed window in plain words", async () => {
    mocks.getSubmission.mockResolvedValue({ ...accepted, canReopen: true });
    mocks.reopen.mockRejectedValue(
      new PortalActionError(403, "reopen_pending_review"),
    );
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: reopenRequestLabel }),
    );
    expect(await screen.findByText(reopenPendingMessage)).toBeVisible();
    // The flag is written once: the button is gone for the rest of the visit.
    expect(
      screen.queryByRole("button", { name: reopenRequestLabel }),
    ).not.toBeInTheDocument();
  });
});

describe("satisfaction rating (CP-9)", () => {
  it("rates with a score and optional comment", async () => {
    mocks.getSubmission.mockResolvedValue({ ...accepted, canRate: true });
    renderPage();
    const send = await screen.findByRole("button", { name: "Send rating" });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "4 of 5, satisfied" }));
    fireEvent.change(screen.getByLabelText("Add a comment (optional)"), {
      target: { value: "  Quick  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send rating" }));
    await waitFor(() =>
      expect(mocks.rate).toHaveBeenCalledWith({
        ref: "SUB-7",
        rating: 4,
        comment: "Quick",
      }),
    );
    expect(
      await screen.findByText("Thank you for your feedback."),
    ).toBeVisible();
  });

  it("is not offered unless the server allows it, and prefills an existing rating", async () => {
    const none = renderPage();
    await screen.findByText("Laptop replacement");
    expect(screen.queryByText("How did we do?")).not.toBeInTheDocument();
    none.unmount();
    mocks.getSubmission.mockResolvedValue({
      ...accepted,
      canRate: true,
      satisfaction: { rating: 2, comment: "Slow" },
    });
    renderPage();
    expect(
      await screen.findByRole("button", { name: "Update rating" }),
    ).toBeEnabled();
    expect(screen.getByDisplayValue("Slow")).toBeVisible();
  });
});

describe("organisation colleague (CP-16)", () => {
  it("shows a read-only view with no actions, reply, withdraw or rating", async () => {
    mocks.getSubmission.mockResolvedValue({
      ...accepted,
      isRequester: false,
      canWithdraw: true,
      canReopen: true,
      canRate: true,
      messages: [
        {
          id: "m1",
          actorType: "customer",
          mine: false,
          authorName: null,
          body: "Hi",
          createdAt: "2026-10-21T10:00:00Z",
        },
      ],
    });
    renderPage();
    expect(
      await screen.findByText(/only the person who raised it can change it/u),
    ).toBeVisible();
    for (const name of [
      "Raise priority",
      "Reopen request",
      "Withdraw request",
      "Send reply",
      "Send rating",
    ])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.getByText(/^A colleague ·/u)).toBeVisible();
  });
});

describe("customer status, service target metric and colleague view (CP-5, CP-6, CP-16)", () => {
  it("shows the server's customer status, never a raw workflow state", async () => {
    mocks.getSubmission.mockResolvedValue({
      ...accepted,
      customerStatus: "resolved",
      workItem: { ...accepted.workItem, state: "Waiting for L2" },
    });
    const { container } = renderPage();
    expect(await screen.findByText("Hardware · Resolved")).toBeVisible();
    expect(screen.getAllByText("Resolved").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/Waiting for L2|In progress/u);
  });

  it("falls back to the submission state wording without a customer status", async () => {
    mocks.getSubmission.mockResolvedValue({
      ...accepted,
      workItem: { ...accepted.workItem, state: "Triage" },
    });
    const { container } = renderPage();
    expect(await screen.findByText("Hardware · In progress")).toBeVisible();
    expect(container.textContent).not.toContain("Triage");
  });

  it("labels a first-response target as such", async () => {
    mocks.getSubmission.mockResolvedValue({
      ...accepted,
      workItem: {
        ...accepted.workItem,
        sla: { ...accepted.workItem.sla, metric: "first_response" },
      },
    });
    renderPage();
    expect(
      await screen.findByText(/First response due by .* today/u),
    ).toBeVisible();
    expect(screen.queryByText(/Resolution due/u)).not.toBeInTheDocument();
  });

  it("shows empty states for an empty conversation and no attachments", async () => {
    mocks.getSubmission.mockResolvedValue({ ...accepted, messages: [] });
    renderPage();
    expect(await screen.findByText("No messages yet")).toBeVisible();
    expect(await screen.findByText("No attachments")).toBeVisible();
  });

  it("gives a colleague no attachment fetch, list, error or upload", async () => {
    mocks.getSubmission.mockResolvedValue({
      ...accepted,
      submission: { ...accepted.submission, state: "clarifying" },
      isRequester: false,
      version: {
        formSchema: { fields: [{ key: "f", label: "File", type: "file" }] },
      },
    });
    mocks.getAttachments.mockRejectedValue(new Error("404"));
    renderPage();
    await screen.findByText("Your answers");
    expect(mocks.getAttachments).not.toHaveBeenCalled();
    expect(screen.queryByText("Attachments")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Could not load attachments."),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/File/u)).not.toBeInTheDocument();
  });

  it("uploads a file field's file through the library uploader, with no visible native picker", async () => {
    mocks.getSubmission.mockResolvedValue({
      ...accepted,
      submission: { ...accepted.submission, state: "clarifying" },
      version: {
        formSchema: {
          fields: [{ key: "evidence", label: "Evidence", type: "file" }],
        },
      },
    });
    mocks.getAttachments.mockResolvedValue([]);
    mocks.presign.mockResolvedValue({
      attachmentId: "att-1",
      uploadUrl: "https://storage.example.test/upload",
      uploadHeaders: {},
    });
    mocks.complete.mockResolvedValue({ id: "att-1" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const { container } = renderPage();
    const choose = await screen.findByRole("button", { name: "Add file" });
    expect(choose).toBeVisible();
    const picker = container.querySelector<HTMLInputElement>(
      "#submission-file-evidence",
    );
    expect(picker).not.toBeNull();
    expect(picker).toHaveAttribute("type", "file");
    expect(picker).toHaveAttribute("tabindex", "-1");
    // The library Input puts the class on its control wrapper.
    expect(picker?.closest('[data-slot="input-control"]')?.className).toContain(
      "sr-only",
    );
    const file = new File(["proof"], "proof.txt", { type: "text/plain" });
    fireEvent.change(picker as HTMLInputElement, {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(mocks.presign).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: "SUB-7",
          fieldKey: "evidence",
          filename: "proof.txt",
        }),
      ),
    );
    await waitFor(() =>
      expect(mocks.complete).toHaveBeenCalledWith({
        ref: "SUB-7",
        id: "att-1",
      }),
    );
    fetchSpy.mockRestore();
  });

  it("honours explicit attachment flags from the server", async () => {
    mocks.getSubmission.mockResolvedValue({
      ...accepted,
      isRequester: false,
      canViewAttachments: true,
      canUpload: false,
    });
    renderPage();
    expect(await screen.findByText("No attachments")).toBeVisible();
    expect(mocks.getAttachments).toHaveBeenCalled();
  });
});
