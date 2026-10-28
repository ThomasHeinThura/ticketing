import { Button, Dialog, DialogPopup, DialogTitle } from "@taskdesk/ui";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiUrl } from "@/fetchers/get-api-url";
import {
  isPdfPreviewPortMessage,
  PDF_PREVIEW_LIMITS,
  PDF_PREVIEW_PROTOCOL,
} from "@/pdf-preview/protocol";

export type PdfPreviewAttachment = {
  id: string;
  filename: string;
  previewPath: string;
  downloadPath: string;
};

function makeNonce() {
  const values = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...values))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export default function PdfPreviewDialog({
  attachment,
  onOpenChange,
}: {
  attachment: PdfPreviewAttachment | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const channelRef = useRef<MessagePort | null>(null);
  const nonceRef = useRef<string | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedBytesRef = useRef(false);
  const [error, setError] = useState<"unavailable" | "too_large" | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);

  const sendPage = useCallback((nextPage: number, nextScale: number) => {
    const channel = channelRef.current;
    const nonce = nonceRef.current;
    if (!channel || !nonce) return;
    channel.postMessage({
      protocol: PDF_PREVIEW_PROTOCOL,
      type: "page",
      nonce,
      pageNumber: nextPage,
      scale: nextScale,
    });
  }, []);

  const closeChannel = useCallback(() => {
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = null;
    const channel = channelRef.current;
    const nonce = nonceRef.current;
    if (channel && nonce) {
      channel.postMessage({
        protocol: PDF_PREVIEW_PROTOCOL,
        type: "dispose",
        nonce,
      });
      channel.close();
    }
    channelRef.current = null;
    nonceRef.current = null;
    loadedBytesRef.current = false;
  }, []);

  const loadBytes = useCallback(
    async (channel: MessagePort, nonce: string) => {
      const selected = attachment;
      if (!selected || loadedBytesRef.current) return;
      loadedBytesRef.current = true;
      setLoading(true);
      setError(null);
      const abort = new AbortController();
      fetchAbortRef.current = abort;
      const clearLoadTimeout = () => {
        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      };
      try {
        const response = await fetch(getApiUrl(selected.previewPath), {
          credentials: "same-origin",
          cache: "no-store",
          signal: abort.signal,
        });
        if (response.status === 413) {
          clearLoadTimeout();
          setError("too_large");
          return;
        }
        const lengthHeader = response.headers.get("content-length");
        const declaredLength = lengthHeader ? Number(lengthHeader) : null;
        if (
          !response.ok ||
          response.headers.get("content-type")?.split(";")[0]?.trim() !==
            "application/pdf" ||
          declaredLength === null ||
          !Number.isSafeInteger(declaredLength) ||
          declaredLength < 4 ||
          declaredLength > PDF_PREVIEW_LIMITS.bytes
        ) {
          clearLoadTimeout();
          setError("unavailable");
          return;
        }
        const bytes = await response.arrayBuffer();
        if (
          bytes.byteLength !== declaredLength ||
          bytes.byteLength > PDF_PREVIEW_LIMITS.bytes
        ) {
          clearLoadTimeout();
          setError("unavailable");
          return;
        }
        const signature = new Uint8Array(bytes, 0, 4);
        if (
          signature[0] !== 0x25 ||
          signature[1] !== 0x50 ||
          signature[2] !== 0x44 ||
          signature[3] !== 0x46
        ) {
          clearLoadTimeout();
          setError("unavailable");
          return;
        }
        channel.postMessage(
          { protocol: PDF_PREVIEW_PROTOCOL, type: "document", nonce, bytes },
          [bytes],
        );
      } catch {
        clearLoadTimeout();
        if (!abort.signal.aborted) setError("unavailable");
      } finally {
        if (fetchAbortRef.current === abort) fetchAbortRef.current = null;
        setLoading(false);
      }
    },
    [attachment],
  );

  const onFrameLoad = useCallback(() => {
    closeChannel();
    const frame = frameRef.current;
    if (!frame?.contentWindow || !attachment) return;
    const nonce = makeNonce();
    const channel = new MessageChannel();
    nonceRef.current = nonce;
    channelRef.current = channel.port1;
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      if (!isPdfPreviewPortMessage(event.data, nonce)) return;
      switch (event.data.type) {
        case "connected":
          if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = setTimeout(() => {
            setError("unavailable");
            closeChannel();
          }, PDF_PREVIEW_LIMITS.loadMs + 5_000);
          void loadBytes(channel.port1, nonce);
          break;
        case "loaded":
          if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = null;
          if (typeof event.data.pageCount === "number") {
            setPageCount(event.data.pageCount);
            setPageNumber(1);
          }
          break;
        case "rendered":
          if (typeof event.data.pageNumber === "number")
            setPageNumber(event.data.pageNumber);
          if (typeof event.data.scale === "number") setScale(event.data.scale);
          break;
        case "failed":
          if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = null;
          setError("unavailable");
          break;
      }
    };
    channel.port1.start();
    loadTimeoutRef.current = setTimeout(() => {
      setError("unavailable");
      closeChannel();
    }, 5_000);
    frame.contentWindow.postMessage(
      { protocol: PDF_PREVIEW_PROTOCOL, type: "init", nonce },
      "*",
      [channel.port2],
    );
  }, [attachment, closeChannel, loadBytes]);

  useEffect(() => {
    setError(null);
    setPageCount(null);
    setPageNumber(1);
    setScale(1);
    loadedBytesRef.current = false;
    return closeChannel;
  }, [closeChannel]);

  const open = Boolean(attachment);
  const pageMessage = pageCount
    ? t("workItems:detail.attachments.pdfPreviewPage", {
        page: pageNumber,
        count: pageCount,
      })
    : t("workItems:detail.attachments.pdfPreviewLoading");

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeChannel();
          onOpenChange(false);
        }
      }}
    >
      <DialogPopup
        className="max-w-5xl overflow-hidden p-0"
        showCloseButton={false}
        bottomStickOnMobile={false}
      >
        {attachment && (
          <div className="flex max-h-[90vh] min-h-0 flex-col">
            <DialogTitle className="sr-only">
              {t("workItems:detail.attachments.pdfPreviewTitle")}:{" "}
              {attachment.filename}
            </DialogTitle>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border p-2">
              <span className="w-full break-all px-2 font-medium text-sm sm:min-w-0 sm:flex-1 sm:truncate">
                {attachment.filename}
              </span>
              <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
                <span
                  className="whitespace-nowrap px-2 text-muted-foreground text-xs"
                  aria-live="polite"
                >
                  {error === "too_large"
                    ? t("workItems:detail.attachments.pdfPreviewTooLarge")
                    : error === "unavailable"
                      ? t("workItems:detail.attachments.pdfPreviewUnavailable")
                      : pageMessage}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!pageCount || pageNumber <= 1}
                  aria-label={t(
                    "workItems:detail.attachments.pdfPreviewPreviousPage",
                  )}
                  onClick={() => sendPage(pageNumber - 1, scale)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!pageCount || pageNumber >= pageCount}
                  aria-label={t(
                    "workItems:detail.attachments.pdfPreviewNextPage",
                  )}
                  onClick={() => sendPage(pageNumber + 1, scale)}
                >
                  <ChevronRight className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={scale <= PDF_PREVIEW_LIMITS.scaleMin}
                  aria-label={t(
                    "workItems:detail.attachments.pdfPreviewZoomOut",
                  )}
                  onClick={() =>
                    sendPage(
                      pageNumber,
                      Math.max(PDF_PREVIEW_LIMITS.scaleMin, scale - 0.25),
                    )
                  }
                >
                  <Minus className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={scale >= PDF_PREVIEW_LIMITS.scaleMax}
                  aria-label={t(
                    "workItems:detail.attachments.pdfPreviewZoomIn",
                  )}
                  onClick={() =>
                    sendPage(
                      pageNumber,
                      Math.min(PDF_PREVIEW_LIMITS.scaleMax, scale + 0.25),
                    )
                  }
                >
                  <Plus className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  render={<a href={getApiUrl(attachment.downloadPath)} />}
                  aria-label={t(
                    "workItems:detail.attachments.pdfPreviewDownload",
                    { name: attachment.filename },
                  )}
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
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-3">
              <iframe
                key={attachment.id}
                ref={frameRef}
                title={t("workItems:detail.attachments.pdfPreviewTitle")}
                src="/pdf-preview.html"
                sandbox="allow-scripts"
                referrerPolicy="origin"
                onLoad={onFrameLoad}
                className="h-[72vh] min-h-72 w-full border-0 bg-background"
              />
              {loading ? <span className="sr-only">{pageMessage}</span> : null}
            </div>
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}
