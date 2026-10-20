import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemDescription, {
  DESCRIPTION_SAVE_DELAY_MS,
} from "./work-item-description";
import { WorkItemFeedbackProvider } from "./work-item-feedback";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: mocks.update,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));

/** Stands in for kaneo's editor with the same contract: it shows `documentValue` whenever
 * that prop changes, and reports the user's typing through `onDocumentChange`. */
vi.mock("@/components/activity/comment-editor", async () => {
  const { useEffect, useState } = await import("react");
  return {
    default: function EditorDouble({
      documentValue,
      onDocumentChange,
    }: {
      documentValue?: unknown;
      onDocumentChange?: (document: unknown) => void;
    }) {
      const [text, setText] = useState(docText(documentValue));
      useEffect(() => {
        setText(docText(documentValue));
      }, [documentValue]);
      return (
        // ui-exempt: this test double stands in for kaneo's rich-text editor.
        <textarea
          aria-label="description"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onDocumentChange?.(doc(event.target.value));
          }}
        />
      );
    },
  };
});

function doc(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function docText(value: unknown) {
  const node = value as
    | { content?: { content?: { text?: string }[] }[] }
    | undefined;
  return node?.content?.[0]?.content?.[0]?.text ?? "";
}

function item(overrides: Partial<WorkItemDetailRow> = {}) {
  return {
    key: "HELP-7",
    number: 7,
    projectId: "p1",
    workspaceId: "w1",
    title: "Printer jammed",
    description: doc("Original"),
    stateName: "To do",
    priority: "high",
    startDate: null,
    dueDate: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    version: 4,
    unavailableFields: [],
    ...overrides,
  } as unknown as WorkItemDetailRow;
}

function setup(current = item(), latest?: WorkItemDetailRow) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // What a refetch of the detail returns (someone else's newer version).
  if (latest) {
    client.setQueryDefaults(["work-items", "detail", current.key], {
      queryFn: () => latest,
    });
  }
  client.setQueryData(["work-items", "detail", current.key], current);
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <WorkItemFeedbackProvider>{node}</WorkItemFeedbackProvider>
    </QueryClientProvider>
  );
  const view = render(
    wrap(<WorkItemDescription item={current} onAccessLost={vi.fn()} />),
  );
  return {
    client,
    view,
    rerender: (next: WorkItemDetailRow) =>
      view.rerender(
        wrap(<WorkItemDescription item={next} onAccessLost={vi.fn()} />),
      ),
    editor: () => screen.getByLabelText("description") as HTMLTextAreaElement,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocks.update.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WorkItemDescription", () => {
  it("does not wipe text typed while its own save was in flight", async () => {
    mocks.update.mockResolvedValue({
      key: "HELP-7",
      version: 5,
      description: doc("Saved part"),
    });
    const { editor, rerender } = setup();
    fireEvent.focus(editor());
    fireEvent.change(editor(), { target: { value: "Saved part" } });
    await act(async () => {
      vi.advanceTimersByTime(DESCRIPTION_SAVE_DELAY_MS);
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    fireEvent.change(editor(), { target: { value: "Saved part and more" } });
    // The refetch lands with the saved document while the user keeps typing.
    rerender(item({ description: doc("Saved part"), version: 5 }));
    expect(editor().value).toBe("Saved part and more");
    // Even after leaving the field, the echo of our own save is not applied.
    fireEvent.blur(editor());
    rerender(item({ description: doc("Saved part"), version: 5 }));
    expect(editor().value).toBe("Saved part and more");
  });

  it("shows a newer description from elsewhere when the user is not editing", () => {
    const { editor, rerender } = setup();
    rerender(item({ description: doc("Edited in another tab"), version: 5 }));
    expect(editor().value).toBe("Edited in another tab");
  });

  it("flushes a pending save on unmount", async () => {
    mocks.update.mockResolvedValue({ key: "HELP-7", version: 5 });
    const { editor, view } = setup();
    fireEvent.change(editor(), { target: { value: "Quick edit" } });
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.update).toHaveBeenCalledWith({
      key: "HELP-7",
      version: 4,
      description: doc("Quick edit"),
    });
  });

  it("resets to the server's description on a version conflict", async () => {
    mocks.update.mockRejectedValue(new WorkItemVersionConflictError(4, 5));
    const { editor } = setup(
      item(),
      item({ description: doc("Their text"), version: 5 }),
    );
    fireEvent.focus(editor());
    fireEvent.change(editor(), { target: { value: "My text" } });
    fireEvent.blur(editor());
    await vi.waitFor(() => expect(editor().value).toBe("Their text"));
  });
});
