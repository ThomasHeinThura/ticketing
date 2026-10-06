import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { useEffect, useState } from "react";
import type { Highlighter } from "shiki";

/** Load the shared tokenizer only when this editor contains a real code block. */
export function useShikiHighlighterForCode(editor: Editor | null) {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);

  useEffect(() => {
    if (!editor) return;

    let disposed = false;
    let requested = false;
    const loadWhenNeeded = () => {
      if (requested) return;

      let hasCodeBlock = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "codeBlock") {
          hasCodeBlock = true;
          return false;
        }
        return !hasCodeBlock;
      });
      if (!hasCodeBlock) return;

      requested = true;
      void import("@/lib/shiki-highlighter")
        .then(({ getSharedShikiHighlighter }) => getSharedShikiHighlighter())
        .then((instance) => {
          if (!disposed) setHighlighter(instance);
        })
        .catch((error) => {
          requested = false;
          // The editor can still display and edit code without token colors.
          console.error("Failed to initialize Shiki highlighter:", error);
        });
    };
    const loadAfterDocumentChange = ({
      transaction,
    }: {
      transaction: Transaction;
    }) => {
      if (transaction.docChanged) loadWhenNeeded();
    };

    loadWhenNeeded();
    editor.on("transaction", loadAfterDocumentChange);
    return () => {
      disposed = true;
      editor.off("transaction", loadAfterDocumentChange);
    };
  }, [editor]);

  return highlighter;
}
