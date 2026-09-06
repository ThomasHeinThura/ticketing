import CommentEditor from "@/components/activity/comment-editor";

type MarkdownRendererProps = {
  content: string;
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <CommentEditor
      value={content}
      readOnly
      showBubbleMenu={false}
      proseClassName="taskdesk-tiptap-prose"
      contentClassName="taskdesk-tiptap-content"
      className="[&_.taskdesk-tiptap-content_.ProseMirror]:max-h-none [&_.taskdesk-tiptap-content_.ProseMirror]:overflow-visible [&_.taskdesk-tiptap-content_.ProseMirror]:px-0 [&_.taskdesk-tiptap-content_.ProseMirror]:py-0"
    />
  );
}
