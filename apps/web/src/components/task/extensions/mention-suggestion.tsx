import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion";
import MentionList, {
  type MentionListRef,
  type MentionMember,
} from "./mention-list";

type MentionSuggestionOptions = {
  getMembers: () => MentionMember[];
};

// Adds an @-triggered autocomplete of workspace members to an editor. On select
// it inserts a `taskdeskMention` node (which round-trips through Markdown). Built on
// @tiptap/suggestion so it stays self-contained and does not touch the editor's
// own keyboard/menu handling.
export const MentionSuggestion = Extension.create<MentionSuggestionOptions>({
  name: "taskdeskMentionSuggestion",

  addOptions() {
    return { getMembers: () => [] };
  },

  addStorage() {
    return {
      // Re-evaluates an already-active suggestion against the latest candidates.
      // Tiptap only calls `items()` on query/range changes, so candidates that
      // arrive (or change with visibility) after the user typed `@` need this.
      refresh: (() => {}) as () => void,
    };
  },

  addProseMirrorPlugins() {
    const getMembers = this.options.getMembers;
    const storage = this.storage;
    const filterMembers = (query: string) => {
      const q = query.toLowerCase();
      return getMembers()
        .filter((m) => m.label?.toLowerCase().includes(q))
        .slice(0, 8);
    };

    const suggestion: Omit<SuggestionOptions, "editor"> = {
      char: "@",
      pluginKey: new PluginKey("taskdeskMentionSuggestion"),
      allowSpaces: false,
      items: ({ query }) => filterMembers(query),
      command: ({ editor, range, props }) => {
        const member = props as unknown as MentionMember;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: "taskdeskMention",
              attrs: { id: member.id, label: member.label },
            },
            { type: "text", text: " " },
          ])
          .run();
      },
      render: () => {
        let component: ReactRenderer<MentionListRef> | null = null;
        let popup: HTMLDivElement | null = null;
        let lastProps: SuggestionProps | null = null;

        const place = (clientRect?: (() => DOMRect | null) | null) => {
          if (!popup || !clientRect) return;
          const rect = clientRect();
          if (!rect) return;
          popup.style.top = `${rect.bottom + window.scrollY + 4}px`;
          popup.style.left = `${rect.left + window.scrollX}px`;
        };

        return {
          onStart: (props) => {
            lastProps = props;
            storage.refresh = () => {
              if (!component || !lastProps) return;
              component.updateProps({
                ...lastProps,
                items: filterMembers(lastProps.query),
              });
            };
            component = new ReactRenderer(MentionList, {
              props,
              editor: props.editor,
            });
            popup = document.createElement("div");
            popup.className = "taskdesk-mention-popup";
            popup.appendChild(component.element);
            document.body.appendChild(popup);
            place(props.clientRect);
          },
          onUpdate: (props) => {
            lastProps = props;
            component?.updateProps(props);
            place(props.clientRect);
          },
          onKeyDown: (props) => {
            if (props.event.key === "Escape") return false;
            return component?.ref?.onKeyDown(props) ?? false;
          },
          onExit: () => {
            lastProps = null;
            storage.refresh = () => {};
            popup?.remove();
            popup = null;
            component?.destroy();
            component = null;
          },
        };
      },
    };

    return [Suggestion({ editor: this.editor, ...suggestion })];
  },
});
