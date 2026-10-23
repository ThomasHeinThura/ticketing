import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  KbdSequence,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@taskdesk/ui";
import { ArrowUp, Paperclip } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  COMMENT_COMPOSER_EDITOR_CLASS,
  CommentComposerPresentation,
} from "@/components/activity/comment-composer-presentation";
import CommentEditor from "@/components/activity/comment-editor";
import useCreateComment from "@/hooks/mutations/comment/use-create-comment";
import { getModifierKeyText } from "@/hooks/use-keyboard-shortcuts";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

type CommentInputProps = {
  taskId: string;
};

function CommentInput({ taskId }: CommentInputProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [attachAction, setAttachAction] = useState<(() => void) | null>(null);
  const { mutateAsync: createComment, isPending } = useCreateComment();
  const queryClient = useQueryClient();

  const handleSubmit = useCallback(async () => {
    if (!content.trim()) {
      toast.error(t("activity:comment.cannotBeEmpty"));
      return;
    }

    try {
      await createComment({
        taskId,
        comment: content,
      });

      setContent("");
      await queryClient.invalidateQueries({ queryKey: ["activities", taskId] });

      toast.success(t("activity:comment.added"));
    } catch (error) {
      console.error("Failed to create comment:", error);
      toast.error(t("activity:comment.failedToAdd"));
    }
  }, [content, createComment, queryClient, t, taskId]);

  const handleAttachActionChange = useCallback(
    (nextAttachAction: (() => void) | null) => {
      setAttachAction(() => nextAttachAction);
    },
    [],
  );

  return (
    <div className="w-full">
      <CommentComposerPresentation
        editor={
          <CommentEditor
            value={content}
            onChange={setContent}
            placeholder={t("activity:comment.leavePlaceholder")}
            taskId={taskId}
            uploadSurface="comment"
            showQuickAttachButton={false}
            onAttachActionChange={handleAttachActionChange}
            className={COMMENT_COMPOSER_EDITOR_CLASS}
            onSubmitShortcut={handleSubmit}
          />
        }
        footerEnd={
          <>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => attachAction?.()}
              disabled={!attachAction}
              className="text-muted-foreground"
              aria-label={t("activity:comment.attachFile")}
            >
              <Paperclip className="size-3.5" />
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="xs"
                    variant="default"
                    onClick={handleSubmit}
                    disabled={isPending || !content.trim()}
                    aria-busy={isPending}
                    data-testid="comment-submit"
                    className={cn(
                      isPending ||
                        (!content.trim() && "opacity-50 cursor-not-allowed"),
                      content.trim().length > 0 &&
                        "bg-primary text-primary-foreground",
                    )}
                    aria-label={t("activity:comment.submitShortcut")}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <KbdSequence
                    keys={[getModifierKeyText(), "Enter"]}
                    description={t("activity:comment.submitShortcut")}
                  />
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </>
        }
      />
    </div>
  );
}

export default memo(CommentInput);
