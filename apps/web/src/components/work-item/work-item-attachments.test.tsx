import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkItemAttachments from "./work-item-attachments";

const listAttachments = vi.hoisted(() => vi.fn());
const deleteAttachment = vi.hoisted(() => vi.fn());
const presignAttachment = vi.hoisted(() => vi.fn());
const completeAttachment = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/work-item/attachments", () => ({
  listWorkItemAttachments: (...args: unknown[]) => listAttachments(...args),
  deleteWorkItemAttachment: (...args: unknown[]) => deleteAttachment(...args),
  presignWorkItemAttachment: (...args: unknown[]) => presignAttachment(...args),
  completeWorkItemAttachment: (...args: unknown[]) =>
    completeAttachment(...args),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const imageAttachment = {
  id: "attachment-1",
  workItemId: "work-item-1",
  filename: "screenshot.png",
  mimeType: "image/png",
  size: 2048,
  state: "ready",
  customerVisible: false,
  uploadedBy: "person-1",
  createdAt: "2026-10-04T12:00:00.000Z",
  deletedAt: null,
};

function renderAttachments(
  options: {
    previewAttachmentId?: string;
    onPreviewAttachment?: (id: string | null) => void;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkItemAttachments
        workItemKey="WI-1"
        workspaceId="workspace-1"
        {...options}
      />
    </QueryClientProvider>,
  );
}

describe("work-item attachment screen (AT-1/AT-5/AT-7/AT-8/AT-9)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists ready files with a protected download and confirms uploader deletion", async () => {
    listAttachments.mockResolvedValue([imageAttachment]);
    deleteAttachment.mockResolvedValue({
      ...imageAttachment,
      state: "deleted",
    });
    renderAttachments();

    const download = await screen.findByRole("link", {
      name: "workItems:attachments.download",
    });
    expect(download.getAttribute("href")).toContain("attachments/attachment-1");
    expect(download.getAttribute("href")).not.toContain(
      "representation=preview",
    );
    expect(
      await screen.findByRole("button", {
        name: "workItems:attachments.preview",
      }),
    ).toBeTruthy();
    expect(screen.getByText("workItems:attachments.internalOnly")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "workItems:attachments.delete" }),
    );
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(deleteAttachment).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "workItems:attachments.deleteAction",
      }),
    );
    await waitFor(() =>
      expect(deleteAttachment).toHaveBeenCalledWith("attachment-1"),
    );
    await waitFor(() => expect(listAttachments).toHaveBeenCalledTimes(2));
  });

  it("opens an image preview from URL state using the authenticated inline endpoint", async () => {
    listAttachments.mockResolvedValue([imageAttachment]);
    const onPreviewAttachment = vi.fn();
    renderAttachments({
      previewAttachmentId: imageAttachment.id,
      onPreviewAttachment,
    });

    const image = await screen.findByRole("img", {
      name: imageAttachment.filename,
    });
    expect(image.getAttribute("src")).toContain(
      "/api/attachments/attachment-1?representation=preview",
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onPreviewAttachment).not.toHaveBeenCalled();
  });

  it("selects an image preview without changing the ordinary download URL", async () => {
    listAttachments.mockResolvedValue([imageAttachment]);
    const onPreviewAttachment = vi.fn();
    renderAttachments({ onPreviewAttachment });

    const preview = await screen.findByRole("button", {
      name: "workItems:attachments.preview",
    });
    fireEvent.click(preview);
    expect(onPreviewAttachment).toHaveBeenCalledWith(imageAttachment.id);
    expect(
      screen
        .getByRole("link", { name: "workItems:attachments.download" })
        .getAttribute("href"),
    ).not.toContain("representation=preview");
  });

  it("does not offer preview for unapproved MIME types", async () => {
    listAttachments.mockResolvedValue([
      {
        ...imageAttachment,
        mimeType: "image/svg+xml",
        filename: "diagram.svg",
      },
    ]);
    renderAttachments();
    await screen.findByText("diagram.svg");
    expect(
      screen.queryByRole("button", { name: "workItems:attachments.preview" }),
    ).toBeNull();
  });

  it("uploads each selected file directly and refreshes the ready attachment list", async () => {
    listAttachments.mockResolvedValue([imageAttachment]);
    presignAttachment.mockImplementation(
      async (input: { filename: string }) => {
        if (input.filename.endsWith(".exe")) {
          throw new Error("Executable files aren't allowed.");
        }
        return {
          uploadUrl: "https://storage.example/upload",
          uploadHeaders: { "Content-Type": "image/png" },
          attachmentId: "attachment-uploaded",
        };
      },
    );
    completeAttachment.mockResolvedValue({
      ...imageAttachment,
      id: "attachment-uploaded",
    });
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        upload = {
          onprogress: null as ((event: ProgressEvent) => void) | null,
        };
        status = 204;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onabort: (() => void) | null = null;
        open() {}
        setRequestHeader() {}
        send() {
          this.upload.onprogress?.({
            lengthComputable: true,
            loaded: 4,
            total: 4,
          } as ProgressEvent);
          queueMicrotask(() => this.onload?.());
        }
        abort() {
          this.onabort?.();
        }
      },
    );
    renderAttachments();

    const input = await screen.findByLabelText(
      "workItems:attachments.addFiles",
    );
    fireEvent.change(input, {
      target: {
        files: [
          new File(["image"], "new.png", { type: "image/png" }),
          new File(["bad"], "blocked.exe", {
            type: "application/octet-stream",
          }),
        ],
      },
    });

    await waitFor(() =>
      expect(completeAttachment).toHaveBeenCalledWith("attachment-uploaded"),
    );
    expect(presignAttachment).toHaveBeenCalledTimes(2);
    expect(presignAttachment).toHaveBeenCalledWith({
      key: "WI-1",
      filename: "new.png",
      contentType: "image/png",
      size: 5,
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Executable files aren't allowed.",
    );
    await waitFor(() => expect(listAttachments).toHaveBeenCalledTimes(2));
  });
});
