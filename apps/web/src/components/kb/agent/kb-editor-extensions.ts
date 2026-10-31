import { mergeAttributes, Node } from "@tiptap/core";
import { EyeOff, Hash, Info } from "lucide-react";
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

type SlashEditor = Parameters<CommentEditorSlashCommand["run"]>[0];
type SlashRange = Parameters<CommentEditorSlashCommand["run"]>[1];

function insertCallout(variant: "info" | "internal") {
  return (editor: SlashEditor, range: SlashRange) => {
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
}

/** The plain info callout every document surface (Pages and KB) offers. */
export function createCalloutSlashCommand(labels: {
  callout: string;
  calloutSearch: string;
}): CommentEditorSlashCommand {
  return {
    id: "kb-callout",
    label: labels.callout,
    group: "insert",
    icon: Info,
    search: labels.calloutSearch,
    run: insertCallout("info"),
  };
}

/** KB-only actions: internal notes and work-item references never reach Pages. */
export function createKbOnlySlashCommands(labels: {
  internalCallout: string;
  internalCalloutSearch: string;
  workItemReference: string;
  workItemReferenceSearch: string;
}): CommentEditorSlashCommand[] {
  return [
    {
      id: "kb-internal-callout",
      label: labels.internalCallout,
      group: "insert",
      icon: EyeOff,
      search: labels.internalCalloutSearch,
      run: insertCallout("internal"),
    },
    {
      id: "kb-work-item-reference",
      label: labels.workItemReference,
      group: "insert",
      icon: Hash,
      search: labels.workItemReferenceSearch,
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).insertContent("#").run();
      },
    },
  ];
}

export function createKbSlashCommands(labels: {
  callout: string;
  calloutSearch: string;
  internalCallout: string;
  internalCalloutSearch: string;
  workItemReference: string;
  workItemReferenceSearch: string;
}): CommentEditorSlashCommand[] {
  return [
    createCalloutSlashCommand(labels),
    ...createKbOnlySlashCommands(labels),
  ];
}
