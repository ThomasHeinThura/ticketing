import { Button, Dialog, DialogPopup, DialogTitle } from "@taskdesk/ui";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { WorkItemAttachment } from "@/fetchers/attachment/work-item-attachments";
import { attachmentUrl } from "./work-item-attachments-tile";

/**
 * AT-8's lightbox: the same borderless image dialog Kaneo's editor opens for an inline image,
 * stepping through the item's other images with the arrow keys.
 */
export default function WorkItemAttachmentLightbox({
  images,
  openId,
  onOpenChange,
  onNavigate,
}: {
  images: readonly WorkItemAttachment[];
  openId: string | null;
  onOpenChange: (open: boolean) => void;
  onNavigate: (id: string) => void;
}) {
  const { t } = useTranslation();
  const index = images.findIndex((image) => image.id === openId);
  const current = index >= 0 ? images[index] : undefined;
  const previous = index > 0 ? images[index - 1] : undefined;
  const next = index >= 0 ? images[index + 1] : undefined;

  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && previous) onNavigate(previous.id);
      if (event.key === "ArrowRight" && next) onNavigate(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, next, onNavigate, previous]);

  return (
    <Dialog open={Boolean(current)} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-w-6xl border-0 bg-transparent p-0 shadow-none before:hidden"
        showCloseButton={false}
        bottomStickOnMobile={false}
      >
        {current && (
          <div className="flex max-h-[90vh] flex-col items-center justify-center gap-3 p-4">
            <DialogTitle className="sr-only">{current.filename}</DialogTitle>
            <img
              src={attachmentUrl(current.id)}
              alt={current.filename}
              className="max-h-[78vh] max-w-[92vw] rounded-xl border border-white/12 bg-black/30 object-contain shadow-2xl"
            />
            <div className="flex items-center gap-1 rounded-lg bg-background/90 p-1 text-sm shadow-lg">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!previous}
                aria-label={t("workItems:detail.attachments.previous")}
                onClick={() => previous && onNavigate(previous.id)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="max-w-64 truncate px-2">{current.filename}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!next}
                aria-label={t("workItems:detail.attachments.next")}
                onClick={() => next && onNavigate(next.id)}
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                render={<a href={attachmentUrl(current.id)} />}
                aria-label={t("workItems:detail.attachments.download", {
                  name: current.filename,
                })}
              >
                <Download className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("workItems:detail.attachments.closePreview")}
                onClick={() => onOpenChange(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}
