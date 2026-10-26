import { mergeAttributes, Node } from "@tiptap/core";
import type { CommentEditorSlashCommand } from "@/components/activity/comment-editor";

/** The KB server allowlist accepts this exact `callout` node and `variant` attribute. */
export const KbCallout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: "info",
        parseHTML: (element) => element.getAttribute("data-variant") || "info",
        renderHTML: (attributes) => ({
          "data-variant": attributes.variant,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "aside[data-variant]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(
        {
          class: "my-3 rounded-md border border-border bg-muted/40 px-4 py-2",
        },
        HTMLAttributes,
      ),
      0,
    ];
  },
});

export const KB_EDITOR_EXTENSIONS = [KbCallout];

export function createKbSlashCommands(labels: {
  callout: string;
  calloutSearch: string;
  internalCallout: string;
  internalCalloutSearch: string;
  workItemReference: string;
  workItemReferenceSearch: string;
}): CommentEditorSlashCommand[] {
  const insertCallout =
    (variant: "info" | "internal") =>
    (
      editor: Parameters<CommentEditorSlashCommand["run"]>[0],
      range: { from: number; to: number },
    ) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "callout",
          attrs: { variant },
          content: [{ type: "paragraph" }],
        })
        .run();
    };

  return [
    {
      id: "kb-callout",
      label: labels.callout,
      group: "insert",
      search: labels.calloutSearch,
      run: insertCallout("info"),
    },
    {
      id: "kb-internal-callout",
      label: labels.internalCallout,
      group: "insert",
      search: labels.internalCalloutSearch,
      run: insertCallout("internal"),
    },
    {
      id: "kb-work-item-reference",
      label: labels.workItemReference,
      group: "insert",
      search: labels.workItemReferenceSearch,
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).insertContent("#").run();
      },
    },
  ];
}
