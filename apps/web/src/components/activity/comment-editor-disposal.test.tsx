import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { lifecycle } = vi.hoisted(() => ({
  lifecycle: { instances: [] as Array<Record<string, unknown>> },
}));

vi.mock("@tiptap/react", async () => {
  const React = await import("react");
  const createEditor = () => {
    const instanceId = lifecycle.instances.length;
    let document: unknown = { type: "doc", content: [] };
    const editor = {
      instanceId,
      isDestroyed: false,
      destroy() {
        this.isDestroyed = true;
      },
      on: () => undefined,
      off: () => undefined,
      setEditable: () => undefined,
      view: {
        dom: {
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
        dispatch: () => undefined,
      },
      state: {},
      getJSON: () => document,
      getMarkdown: () => "native body",
      get commands() {
        if (this.isDestroyed) {
          throw new Error("Cannot read disposed editor commands");
        }
        return {
          setContent: (content: unknown) => {
            document = content;
          },
        };
      },
    };
    lifecycle.instances.push(editor);
    return editor;
  };
  return {
    // Like Tiptap's `useEditor`, which re-checks its instance on every render: a
    // dependency change or a destroyed instance yields a new editor.
    useEditor: (_options: unknown, dependencies: unknown[] = []) => {
      const current = React.useRef<{
        editor: ReturnType<typeof createEditor>;
        dependencies: unknown[];
      } | null>(null);
      const previous = current.current;
      if (
        !previous ||
        previous.editor.isDestroyed ||
        previous.dependencies.length !== dependencies.length ||
        previous.dependencies.some(
          (dependency, index) => dependency !== dependencies[index],
        )
      ) {
        current.current = { editor: createEditor(), dependencies };
      }
      return current.current?.editor ?? null;
    },
    EditorContent: ({ editor }: { editor: Record<string, unknown> | null }) => {
      React.useLayoutEffect(() => {
        if (editor?.instanceId === 0) {
          (editor.destroy as () => void)();
        }
      }, [editor]);
      return (
        <div
          data-testid="editor-host"
          contentEditable={editor && !editor.isDestroyed ? "true" : "false"}
        />
      );
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

describe("CommentEditor disposal recovery", () => {
  it("recreates a layout-disposed editor and hydrates the new editable instance", async () => {
    lifecycle.instances.length = 0;
    render(
      <CommentEditor
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
        showBubbleMenu={false}
        showQuickAttachButton={false}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("editor-host")).toHaveAttribute(
        "contenteditable",
        "true",
      ),
    );
    expect(lifecycle.instances).toHaveLength(2);
    expect(lifecycle.instances[0]?.isDestroyed).toBe(true);
    expect(lifecycle.instances[1]?.isDestroyed).toBe(false);
  });
});
