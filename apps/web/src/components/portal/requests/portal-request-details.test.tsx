import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expectNoA11yViolations } from "@taskdesk/ui/test/a11y";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalRequestDetail } from "@/fetchers/portal/requests";
import { HttpError } from "@/lib/http-error";
import { PortalRequestDetails } from "./portal-request-details";

const getPortalRequest = vi.hoisted(() => vi.fn());
const getPortalRequestFiles = vi.hoisted(() => vi.fn());
const replyToPortalRequest = vi.hoisted(() => vi.fn());
const uploadPortalRequestFile = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useLocation: () => ({ hash: "" }),
    Link: React.forwardRef<
      HTMLAnchorElement,
      React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }
    >(({ children, to, ...props }, ref) => (
      <a href={to} ref={ref} {...props}>
        {children}
      </a>
    )),
  };
});

vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "name" in options ? `${key}(${String(options.name)})` : key,
    i18n: { resolvedLanguage: "en-US", language: "en-US" },
  }),
}));

vi.mock("@/fetchers/portal/requests", () => ({
  getPortalRequest,
  getPortalRequestFiles,
  replyToPortalRequest,
  uploadPortalRequestFile,
  portalRequestFileUrl: (ref: string, id: string) =>
    `/api/portal/requests/${ref}/attachments/${id}`,
}));

function detail(
  overrides: Partial<PortalRequestDetail> = {},
): PortalRequestDetail {
  return {
    ref: "SUP-12",
    source: "direct",
    title: "Confirm the new VPN profile",
    requestTypeName: "Service request",
    priority: "high",
    customerStatus: "need_more_info",
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-02T09:00:00.000Z",
    project: { key: "SUP", name: "Contoso Support" },
    createdBy: { name: null, isYou: true },
    isRequester: true,
    raisedBySupport: false,
    customerVisibility: "private",
    sla: null,
    description: "Please test the profile on your laptop.",
    resolvedAt: null,
    customFields: [],
    canReply: true,
    canViewAttachments: true,
    canUpload: true,
    messages: [
      {
        id: "c1",
        actorType: "triager",
        authorName: "Sam Support",
        mine: false,
        body: "Can you test it today?",
        createdAt: "2026-11-02T08:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  getPortalRequest.mockReset();
  getPortalRequestFiles.mockReset();
  replyToPortalRequest.mockReset();
  uploadPortalRequestFile.mockReset();
});
afterEach(() => cleanup());

describe("PortalRequestDetails", () => {
  it("shows the request, its public conversation and the team's shared files", async () => {
    getPortalRequest.mockResolvedValue(detail());
    getPortalRequestFiles.mockResolvedValue([
      {
        id: "f1",
        filename: "guide.pdf",
        mimeType: "application/pdf",
        size: 2048,
        state: "ready",
        mine: false,
        downloadable: true,
        createdAt: "2026-11-02T08:30:00.000Z",
      },
    ]);
    render(<PortalRequestDetails portalUserId="u1" requestRef="SUP-12" />, {
      wrapper,
    });
    expect(
      await screen.findByRole("heading", {
        name: "Confirm the new VPN profile",
      }),
    ).toBeVisible();
    expect(screen.getByText("SUP-12")).toBeVisible();
    expect(screen.getByText("Can you test it today?")).toBeVisible();
    expect(screen.getByText(/Sam Support/)).toBeVisible();
    expect(
      await screen.findByRole("link", {
        name: "requestPage.download(guide.pdf)",
      }),
    ).toHaveAttribute("href", "/api/portal/requests/SUP-12/attachments/f1");
    expect(screen.queryByText("requestPage.fileNotDownloadable")).toBeNull();
    expect(
      screen.getByRole("button", { name: "intake.sendReply" }),
    ).toBeDisabled();
  });

  it("lists a file the portal cannot serve without a download, and offers no attach when uploads are off (CP-19)", async () => {
    getPortalRequest.mockResolvedValue(detail({ canUpload: false }));
    getPortalRequestFiles.mockResolvedValue([
      {
        id: "f1",
        filename: "guide.pdf",
        mimeType: "application/pdf",
        size: 2048,
        state: "ready",
        mine: false,
        downloadable: false,
        createdAt: "2026-11-02T08:30:00.000Z",
      },
    ]);
    render(<PortalRequestDetails portalUserId="u1" requestRef="SUP-12" />, {
      wrapper,
    });
    expect(await screen.findByText("guide.pdf")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "requestPage.download(guide.pdf)" }),
    ).toBeNull();
    // The missing Download is explained next to the file.
    expect(screen.getByText("requestPage.fileNotDownloadable")).toBeVisible();
    expect(screen.getByLabelText("intake.reply")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "requestPage.attach" }),
    ).toBeNull();
    expect(screen.queryByLabelText("requestPage.attach")).toBeNull();
  });

  it("is read-only for a colleague: no reply box and no files", async () => {
    getPortalRequest.mockResolvedValue(
      detail({
        isRequester: false,
        canReply: false,
        canViewAttachments: false,
        canUpload: false,
      }),
    );
    render(<PortalRequestDetails portalUserId="u1" requestRef="SUP-12" />, {
      wrapper,
    });
    expect(await screen.findByText("request.readOnly")).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("intake.attachments")).toBeNull();
    expect(getPortalRequestFiles).not.toHaveBeenCalled();
  });

  it("sends a reply and then uploads the chosen files to it", async () => {
    getPortalRequest.mockResolvedValue(detail());
    getPortalRequestFiles.mockResolvedValue([]);
    replyToPortalRequest.mockResolvedValue({
      ref: "SUP-12",
      message: { id: "c2" },
    });
    uploadPortalRequestFile.mockRejectedValueOnce(
      new HttpError(400, '".exe" files aren\'t allowed.'),
    );
    render(<PortalRequestDetails portalUserId="u1" requestRef="SUP-12" />, {
      wrapper,
    });
    const box = await screen.findByLabelText("intake.reply");
    fireEvent.change(box, { target: { value: "Tested, it works." } });
    const file = new File(["x"], "run.exe", {
      type: "application/octet-stream",
    });
    fireEvent.change(screen.getByLabelText("requestPage.attach"), {
      target: { files: [file] },
    });
    expect(screen.getByText("run.exe")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "intake.sendReply" }));
    await waitFor(() =>
      expect(replyToPortalRequest).toHaveBeenCalledWith({
        ref: "SUP-12",
        body: "Tested, it works.",
      }),
    );
    await waitFor(() =>
      expect(uploadPortalRequestFile).toHaveBeenCalledWith({
        ref: "SUP-12",
        commentId: "c2",
        file,
      }),
    );
    expect(
      await screen.findByText(/run\.exe: "\.exe" files aren't allowed\./),
    ).toBeVisible();
  });

  it("tells a colleague whom the team raised the request for, not 'for you'", async () => {
    getPortalRequest.mockResolvedValue(
      detail({
        isRequester: false,
        raisedBySupport: true,
        createdBy: { name: "Bob Colleague", isYou: false },
        canReply: false,
        canViewAttachments: false,
        canUpload: false,
      }),
    );
    render(<PortalRequestDetails portalUserId="u1" requestRef="SUP-12" />, {
      wrapper,
    });
    expect(await screen.findByText("Bob Colleague")).toBeVisible();
    expect(screen.getByText("cases.columns.requester")).toBeVisible();
    expect(screen.getByText("cases.raisedBy")).toBeVisible();
    expect(screen.getByText("cases.supportTeam")).toBeVisible();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it("omits Raised by for a customer-created request", async () => {
    getPortalRequest.mockResolvedValue(detail({ raisedBySupport: false }));
    getPortalRequestFiles.mockResolvedValue([]);
    render(<PortalRequestDetails portalUserId="u1" requestRef="SUP-12" />, {
      wrapper,
    });
    expect(await screen.findByText("cases.columns.requester")).toBeVisible();
    expect(screen.queryByText("cases.raisedBy")).toBeNull();
  });

  it("keeps focus in the reply box after sending and announces the reply", async () => {
    getPortalRequest.mockResolvedValue(detail());
    getPortalRequestFiles.mockResolvedValue([]);
    let finish: (value: unknown) => void = () => undefined;
    replyToPortalRequest.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<PortalRequestDetails portalUserId="u1" requestRef="SUP-12" />, {
      wrapper,
    });
    const box = await screen.findByLabelText("intake.reply");
    fireEvent.change(box, { target: { value: "Tested, it works." } });
    const send = screen.getByRole("button", { name: "intake.sendReply" });
    send.focus();
    fireEvent.click(send);
    // While the reply is on its way the focused button stays focusable (no `disabled`).
    const pending = await screen.findByRole("button", {
      name: "requestPage.sending",
    });
    expect(pending).not.toBeDisabled();
    expect(pending).toHaveAttribute("aria-disabled", "true");
    expect(pending).toHaveFocus();
    expect(box).not.toBeDisabled();
    finish({ ref: "SUP-12", message: { id: "c2" } });
    await waitFor(() => expect(box).toHaveValue(""));
    expect(box).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "requestPage.replySent",
    );
  });

  it("moves focus to the next file, then to Attach files, when a staged file is removed", async () => {
    getPortalRequest.mockResolvedValue(detail());
    getPortalRequestFiles.mockResolvedValue([]);
    render(<PortalRequestDetails portalUserId="u1" requestRef="SUP-12" />, {
      wrapper,
    });
    await screen.findByLabelText("intake.reply");
    const first = new File(["a"], "a.txt", { type: "text/plain" });
    const second = new File(["bb"], "b.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("requestPage.attach"), {
      target: { files: [first, second] },
    });
    const removeFirst = screen.getByRole("button", {
      name: "requestPage.removeFile(a.txt)",
    });
    removeFirst.focus();
    fireEvent.click(removeFirst);
    const removeSecond = await screen.findByRole("button", {
      name: "requestPage.removeFile(b.txt)",
    });
    await waitFor(() => expect(removeSecond).toHaveFocus());
    fireEvent.click(removeSecond);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "requestPage.attach" }),
      ).toHaveFocus(),
    );
  });

  it("is not wrapped in its own main landmark (the portal shell owns <main>)", async () => {
    getPortalRequest.mockResolvedValue(detail());
    getPortalRequestFiles.mockResolvedValue([]);
    const { container } = render(
      <PortalRequestDetails portalUserId="u1" requestRef="SUP-12" />,
      { wrapper },
    );
    await screen.findByRole("heading", { name: "Confirm the new VPN profile" });
    expect(container.querySelector("main")).toBeNull();
    expect(document.title).toBe(
      "Confirm the new VPN profile · SUP-12 · navigation.title",
    );
  });

  it("says the request is not available on a 404", async () => {
    getPortalRequest.mockRejectedValue(new HttpError(404, "Request not found"));
    render(<PortalRequestDetails portalUserId="u1" requestRef="SUP-99" />, {
      wrapper,
    });
    expect(
      await screen.findByRole("heading", {
        name: "requestPage.notFound.title",
      }),
    ).toBeVisible();
  });

  it("has no serious or critical axe violations (G4)", async () => {
    getPortalRequest.mockResolvedValue(detail());
    getPortalRequestFiles.mockResolvedValue([]);
    const { container } = render(
      <PortalRequestDetails portalUserId="u1" requestRef="SUP-12" />,
      { wrapper },
    );
    await screen.findByRole("heading", { name: "Confirm the new VPN profile" });
    await expectNoA11yViolations(container);
  });
});
