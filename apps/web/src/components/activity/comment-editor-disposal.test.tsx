import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { editorStub } = vi.hoisted(() => {
  const stub = {
    isDestroyed: false,
    destroy: () => {
      stub.isDestroyed = true;
    },
    get commands() {
      if (stub.isDestroyed) {
        throw new Error("Cannot read properties of null (reading 'commands')");
      }
      return { setContent: vi.fn() };
    },
  };
  return { editorStub: stub };
});

vi.mock("@tiptap/react", async () => {
  const React = await import("react");
  return {
    useEditor: () => editorStub,
    EditorContent: ({ editor }: { editor: typeof editorStub | null }) => {
      React.useLayoutEffect(() => {
        if (editor && !editor.isDestroyed) editor.destroy();
      }, [editor]);
      return <div data-testid="editor-host" />;
    },
    BubbleMenu: () => null,
  };
});

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

describe("CommentEditor disposed-instance handling", () => {
  it("does not dereference Tiptap commands when layout cleanup disposes it before document hydration", async () => {
    render(
      <CommentEditor
        readOnly
        value="legacy Markdown remains supported"
        documentValue={{
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "native body" }],
            },
          ],
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("editor-host")).toBeInTheDocument(),
    );
  });
});
