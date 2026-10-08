import { Button, Popover, PopoverContent, PopoverTrigger } from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import type { CommentVersion } from "@/fetchers/work-item/get-comment-version-page";
import useGetCommentVersionHistory from "@/hooks/queries/work-item/use-get-comment-version-history";
import { formatDateTime } from "@/lib/format";

function isTiptapDocument(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      (value as { type?: unknown }).type === "doc",
  );
}

export default function CommentVersionHistory({
  workItemKey,
  commentId,
  label,
  editorName,
}: {
  workItemKey: string;
  commentId: string;
  label: string;
  editorName: (id: string | null) => string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const history = useGetCommentVersionHistory({
    key: workItemKey,
    commentId,
    enabled: open,
  });
  const versions = history.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-96 w-[min(32rem,calc(100vw-2rem))] overflow-y-auto">
        <ol
          aria-label={t("activity:timeline.historyLabel")}
          className="flex flex-col gap-3"
        >
          {versions.map((version: CommentVersion) => (
            <li className="border-b pb-3 last:border-0" key={version.number}>
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{editorName(version.editedBy)}</span>
                <time
                  dateTime={version.createdAt}
                  title={formatDateTime(version.createdAt)}
                >
                  {formatDateTime(version.createdAt)}
                </time>
              </div>
              {isTiptapDocument(version.body) ? (
                <CommentEditor
                  value=""
                  documentValue={version.body}
                  readOnly
                  showBubbleMenu={false}
                  showQuickAttachButton={false}
                  enableMentions={false}
                />
              ) : typeof version.body === "string" ? (
                <CommentEditor
                  value={version.body}
                  readOnly
                  showBubbleMenu={false}
                  showQuickAttachButton={false}
                  enableMentions={false}
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words text-sm">
                  {JSON.stringify(version.body, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ol>
        {history.isLoading && (
          <p role="status">{t("activity:timeline.historyLoading")}</p>
        )}
        {history.isError && (
          <div role="alert" className="flex items-center gap-2 text-sm">
            <span>{t("activity:timeline.historyLoadFailed")}</span>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void history.refetch()}
            >
              {t("activity:timeline.retry")}
            </Button>
          </div>
        )}
        {!history.isLoading && !history.isError && versions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("activity:timeline.historyEmpty")}
          </p>
        )}
        {history.hasNextPage && (
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {history.isFetchingNextPage
              ? t("activity:timeline.historyLoading")
              : t("activity:timeline.loadEarlierVersions")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
