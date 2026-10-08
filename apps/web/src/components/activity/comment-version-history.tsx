import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@taskdesk/ui";
import CommentEditor from "@/components/activity/comment-editor";
import type { CommentVersion } from "@/fetchers/work-item/get-work-item-activity";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

type CommentVersionHistoryProps = {
  versions: CommentVersion[];
  label: string;
  editorName: (personId: string | null) => string;
};

export default function CommentVersionHistory({
  versions,
  label,
  editorName,
}: CommentVersionHistoryProps) {
  if (versions.length === 0) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="xs" variant="ghost" aria-label={label}>
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent
          align="start"
          className="max-h-80 w-96 max-w-[min(24rem,calc(100vw-2rem))] overflow-y-auto p-3"
        >
          <ol className="flex flex-col gap-3" aria-label={label}>
            {versions.map((version) => (
              <li
                className="border-border/70 border-b pb-3 last:border-0 last:pb-0"
                key={version.number}
              >
                <time
                  className="block text-muted-foreground"
                  dateTime={version.createdAt}
                  title={formatDateTime(version.createdAt)}
                >
                  {formatRelativeTime(version.createdAt)}
                </time>
                {version.editedBy && (
                  <span className="mb-1 block text-muted-foreground">
                    {editorName(version.editedBy)}
                  </span>
                )}
                <CommentEditor
                  className="rounded-md bg-background p-2"
                  contentClassName="max-h-40 overflow-y-auto"
                  documentValue={version.body}
                  readOnly
                  showBubbleMenu={false}
                  showQuickAttachButton={false}
                  value=""
                />
              </li>
            ))}
          </ol>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
