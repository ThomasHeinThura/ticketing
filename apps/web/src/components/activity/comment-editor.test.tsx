import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import CommentEditor from "@/components/activity/comment-editor";

const documentWithText = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("CommentEditor lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates and replaces native documents through StrictMode disposal while preserving Markdown-only callers", async () => {
    const onChange = vi.fn();
    const firstDocument = documentWithText("native initial body");
    const { rerender, unmount } = render(
      <StrictMode>
        <CommentEditor
          readOnly
          value="legacy fallback"
          documentValue={firstDocument}
          onChange={onChange}
        />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByText("native initial body")).toBeInTheDocument(),
    );

    await act(async () => {
      rerender(
        <StrictMode>
          <CommentEditor
            readOnly
            value="legacy fallback"
            documentValue={documentWithText("native updated body")}
            onChange={onChange}
            placeholder="Changed placeholder to recreate editor options"
          />
        </StrictMode>,
      );
    });

    await waitFor(() =>
      expect(screen.getByText("native updated body")).toBeInTheDocument(),
    );

    await act(async () => {
      rerender(
        <StrictMode>
          <CommentEditor readOnly value="**legacy Markdown still renders**" />
        </StrictMode>,
      );
    });

    await waitFor(() =>
      expect(
        screen.getByText("legacy Markdown still renders"),
      ).toBeInTheDocument(),
    );

    unmount();
  });

  it("keeps legacy Markdown editable and emits text with its matching Tiptap document", async () => {
    const onContentChange = vi.fn();
    const { container } = render(
      <CommentEditor
        value="**workflow transition note**"
        onContentChange={onContentChange}
        showQuickAttachButton={false}
      />,
    );

    const editor = await waitFor(() => {
      const editable = container.querySelector<HTMLElement>(
        '.ProseMirror[contenteditable="true"]',
      );
      expect(editable).not.toBeNull();
      return editable as HTMLElement;
    });
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(screen.getByText("workflow transition note")).toBeInTheDocument();
    await waitFor(() =>
      expect(onContentChange).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "**workflow transition note**",
          document: expect.objectContaining({ type: "doc" }),
        }),
      ),
    );

    editor.querySelector("p")?.append(" updated");
    fireEvent.input(editor, {
      inputType: "insertText",
      data: " updated",
    });
    await waitFor(() =>
      expect(onContentChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("updated"),
          document: expect.objectContaining({ type: "doc" }),
        }),
      ),
    );
  });
});
