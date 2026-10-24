/**
 * TaskDesk stores descriptions and comments as a Tiptap/ProseMirror document. An agent
 * writes plain text; each non-empty line becomes one paragraph. The text is sent as a text
 * node, never parsed as markup, so nothing the agent (or a ticket it copied from) writes can
 * become structure.
 */
export type RichTextDoc = {
  type: "doc";
  content: Array<{
    type: "paragraph";
    content?: Array<{ type: "text"; text: string }>;
  }>;
};

export function textToDoc(text: string): RichTextDoc {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return {
    type: "doc",
    content: lines.map((line) =>
      line.length > 0
        ? { type: "paragraph", content: [{ type: "text", text: line }] }
        : { type: "paragraph" },
    ),
  };
}
