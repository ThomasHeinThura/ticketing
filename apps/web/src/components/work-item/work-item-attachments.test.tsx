vi.mock("@/lib/format", () => ({ formatDateMedium: () => "Oct 22" }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
  openPending: vi.fn(),
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
  uploadWorkItemAttachment: mocks.upload,
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
};
function mount() {
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
        <WorkItemAttachments workItemKey="HELP-4" />
      </QueryClientProvider>,
    ),
  };
}
beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([row]);
  mocks.remove.mockReset();
  mocks.upload.mockReset();
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
