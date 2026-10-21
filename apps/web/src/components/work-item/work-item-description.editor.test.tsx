import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemDescription, {
  DESCRIPTION_SAVE_DELAY_MS,
} from "./work-item-description";
import { WorkItemFeedbackProvider } from "./work-item-feedback";

// The real kaneo editor (Tiptap in jsdom), so the documentValue sync path is exercised;
// only its workspace lookups and code highlighter are stubbed, as its own tests do.
const mocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: mocks.update,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-test" } }),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }),
  }),
);
vi.mock("@/hooks/use-shiki-highlighter-for-code", () => ({
  useShikiHighlighterForCode: () => null,
}));

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function item(description: unknown, version = 4) {
  return {
    key: "HELP-7",
    number: 7,
    projectId: "p1",
    workspaceId: "w1",
    title: "Printer jammed",
    description,
    stateName: "To do",
    priority: "high",
    startDate: null,
    dueDate: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    version,
    unavailableFields: [],
  } as unknown as WorkItemDetailRow;
}

describe("WorkItemDescription with the real editor", () => {
  it("keeps text typed during the round trip when its own save comes back", async () => {
    mocks.update.mockResolvedValue({ key: "HELP-7", version: 5 });
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const wrap = (node: ReactNode) => (
      <QueryClientProvider client={client}>
        <WorkItemFeedbackProvider>{node}</WorkItemFeedbackProvider>
      </QueryClientProvider>
    );
    const { container, rerender } = render(
      wrap(
        <WorkItemDescription
          item={item(doc("Original"))}
          onAccessLost={vi.fn()}
        />,
      ),
    );
    const editor = await waitFor(() => {
      const editable = container.querySelector<HTMLElement>(
        '.ProseMirror[contenteditable="true"]',
      );
      expect(editable).not.toBeNull();
      expect(editable).toHaveTextContent("Original");
      return editable as HTMLElement;
    });
    const type = (text: string) => {
      editor.querySelector("p")?.append(text);
      fireEvent.input(editor, { inputType: "insertText", data: text });
    };

    fireEvent.focus(editor);
    type(" saved");
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    const sent = mocks.update.mock.calls[0]?.[0].description;
    type(" and more");
    await waitFor(() => expect(editor).toHaveTextContent("and more"));

    // The refetch lands with exactly what was saved.
    await act(async () => {
      rerender(
        wrap(
          <WorkItemDescription item={item(sent, 5)} onAccessLost={vi.fn()} />,
        ),
      );
    });
    expect(editor).toHaveTextContent("Original saved and more");
  });

  it("shows a newer description from elsewhere through documentValue", async () => {
    mocks.update.mockReset();
    const client = new QueryClient();
    const wrap = (node: ReactNode) => (
      <QueryClientProvider client={client}>
        <WorkItemFeedbackProvider>{node}</WorkItemFeedbackProvider>
      </QueryClientProvider>
    );
    const { container, rerender } = render(
      wrap(
        <WorkItemDescription
          item={item(doc("Original"))}
          onAccessLost={vi.fn()}
        />,
      ),
    );
    await waitFor(() =>
      expect(container.querySelector(".ProseMirror")).toHaveTextContent(
        "Original",
      ),
    );
    // Let the editor finish its first-mount lifecycle (Tiptap may recreate the instance
    // once, see CommentEditor's disposal effect) before the refetch lands.
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, DESCRIPTION_SAVE_DELAY_MS + 300),
      );
    });
    // Opening the item saves nothing (the editor's own mount-time updates are not edits).
    expect(mocks.update).not.toHaveBeenCalled();
    await act(async () => {
      rerender(
        wrap(
          <WorkItemDescription
            item={item(doc("Edited in another tab"), 5)}
            onAccessLost={vi.fn()}
          />,
        ),
      );
    });
    await waitFor(() =>
      expect(container.querySelector(".ProseMirror")).toHaveTextContent(
        "Edited in another tab",
      ),
    );
  });
});
