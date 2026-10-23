vi.mock("@/lib/format", () => ({ formatDateMedium: () => "Oct 22" }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  enqueue: vi.fn(),
  candidates: vi.fn(),
  openPending: vi.fn(),
  canAttach: { value: true },
  noUploads: [] as never[],
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateAttachments: () => mocks.canAttach.value,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/fetchers/work-item/get-comment-mention-candidates", () => ({
  default: mocks.candidates,
}));
vi.mock("@/fetchers/attachment/work-item-upload-queue", () => ({
  enqueueWorkItemUploads: mocks.enqueue,
  retryWorkItemUpload: vi.fn(),
  dismissWorkItemUpload: vi.fn(),
  getWorkItemUploads: () => mocks.noUploads,
  subscribeWorkItemUploads: () => () => undefined,
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPending,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) =>
      values?.name ? `${key}:${values.name}` : key,
  }),
}));
vi.mock("@/fetchers/attachment/work-item-attachments", () => ({
  listWorkItemAttachments: mocks.list,
  requestAttachmentDeletion: mocks.remove,
}));

import WorkItemAttachments from "./work-item-attachments";

const row = {
  id: "file-1",
  filename: "Proof.pdf",
  mimeType: "application/pdf",
  size: 123,
  state: "ready",
  uploadedBy: "person-1",
  createdAt: "2026-10-22T10:00:00Z",
  deletedAt: null,
  canDelete: true,
  commentId: null,
};
const image = {
  ...row,
  id: "img-1",
  filename: "screen.png",
  mimeType: "image/png",
  canDelete: false,
};
function mount(workspaceId?: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <WorkItemAttachments workItemKey="HELP-4" workspaceId={workspaceId} />
      </QueryClientProvider>,
    ),
  };
}
beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([row]);
  mocks.remove.mockReset();
  mocks.enqueue.mockReset();
  mocks.candidates
    .mockReset()
    .mockResolvedValue([
      { personId: "person-1", name: "Alice", reachable: true },
    ]);
  mocks.canAttach.value = true;
  mocks.openPending.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
describe("canonical attachment delete affordance", () => {
  it.each([false, undefined])(
    "hides trash without authoritative permission (%s) while retaining download",
    async (canDelete) => {
      mocks.list.mockResolvedValue([{ ...row, canDelete }]);
      mount();
      expect(
        await screen.findByRole("link", { name: "Proof.pdf" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /attachments.delete/ }),
      ).toBeNull();
    },
  );
  it("retains visible file and blocks duplicate requests until real confirmation URL opens", async () => {
    let finish!: (result: { pendingActionId: string }) => void;
    mocks.remove.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    const button = await screen.findByRole("button", {
      name: /attachments.delete/,
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
    expect(mocks.remove.mock.calls[0]?.[0]).toBe("file-1");
    expect(screen.getByRole("link", { name: "Proof.pdf" })).toBeInTheDocument();
    expect(mocks.openPending).not.toHaveBeenCalled();
    finish({ pendingActionId: "pa/1" });
    await waitFor(() =>
      expect(mocks.openPending).toHaveBeenCalledWith({
        pendingActionId: "pa/1",
      }),
    );
    expect(screen.getByRole("link", { name: "Proof.pdf" })).toBeInTheDocument();
  });
  it("does not open the approval after current authoritative permission disappears", async () => {
    let finish!: (result: { pendingActionId: string }) => void;
    mocks.remove.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = mount();
    fireEvent.click(
      await screen.findByRole("button", { name: /attachments.delete/ }),
    );
    view.client.setQueryData(
      ["work-items", "attachments", "HELP-4"],
      [{ ...row, canDelete: false }],
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /attachments.delete/ }),
      ).toBeNull(),
    );
    finish({ pendingActionId: "stale" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.openPending).not.toHaveBeenCalled();
  });
  it("ignores a completion after unmount", async () => {
    let finish!: (result: { pendingActionId: string }) => void;
    mocks.remove.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = mount();
    fireEvent.click(
      await screen.findByRole("button", { name: /attachments.delete/ }),
    );
    view.unmount();
    finish({ pendingActionId: "stale" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.openPending).not.toHaveBeenCalled();
  });
  it("reports refusal without removing the persisted file and permits retry", async () => {
    mocks.remove
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValue({ pendingActionId: "retry" });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: /attachments.delete/ }),
    );
    expect(
      await screen.findByText("workItems:detail.attachments.deleteFailed"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Proof.pdf" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /attachments.delete/ }));
    await waitFor(() => expect(mocks.openPending).toHaveBeenCalledTimes(1));
  });
});

describe("AT-8..AT-12 attachment panel", () => {
  it("renders an image as a thumbnail that opens a lightbox, and other files as downloadable cards with size and uploader", async () => {
    mocks.list.mockResolvedValue([row, image]);
    mount();
    const thumbnail = await screen.findByRole("button", {
      name: /attachments.preview:screen.png/,
    });
    expect(thumbnail.querySelector("img")?.getAttribute("src")).toContain(
      "/attachments/img-1",
    );
    // A PDF is a card with a download link, never a thumbnail; the uploader is named.
    const link = screen.getByRole("link", { name: "Proof.pdf" });
    expect(link.getAttribute("href")).toContain("/attachments/file-1");
    await waitFor(() =>
      expect(link.textContent).toContain("attachments.uploadedBy:Alice"),
    );
    fireEvent.click(thumbnail);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("img", { name: "screen.png" }),
    ).toBeInTheDocument();
  });
  it("lists only the work item's own files; a comment's files belong to its comment", async () => {
    mocks.list.mockResolvedValue([
      row,
      {
        ...row,
        id: "comment-file",
        filename: "on-comment.txt",
        commentId: "c1",
      },
    ]);
    mount();
    await screen.findByRole("link", { name: /Proof.pdf/ });
    expect(screen.queryByText("on-comment.txt")).toBeNull();
  });
  it("queues every selected file for upload at once (AT-12)", async () => {
    mocks.list.mockResolvedValue([]);
    mount("workspace-1");
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
    ];
    fireEvent.change(
      await screen.findByLabelText("workItems:detail.attachments.add"),
      { target: { files } },
    );
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue.mock.calls[0]?.[0]).toMatchObject({
      itemKey: "HELP-4",
      files,
    });
    expect(mocks.enqueue.mock.calls[0]?.[0].commentId).toBeUndefined();
  });
  it("offers no Add control without the attachment:create capability", async () => {
    mocks.canAttach.value = false;
    mocks.list.mockResolvedValue([]);
    mount("workspace-1");
    await screen.findByText("workItems:detail.attachments.empty");
    expect(
      screen.queryByLabelText("workItems:detail.attachments.add"),
    ).toBeNull();
  });
});
