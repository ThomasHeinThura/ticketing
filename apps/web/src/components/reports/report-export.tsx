import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  Spinner,
} from "@taskdesk/ui";
import { Download } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadReportExport, type ExportOutcome } from "@/fetchers/report";
import { useReportExport } from "@/hooks/queries/report";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";

/** Hands a finished CSV to the browser as a download. */
type SavePicker = (options: { suggestedName: string }) => Promise<{
  createWritable: () => Promise<WritableStream<Uint8Array>>;
}>;

/**
 * Saves a ready export. The picker opens first, straight from the click, so a slow
 * export cannot outlast the user-activation window; the file is streamed to disk and
 * discarded (never left partial) when the download is refused or breaks.
 */
export async function saveReportExport(id: string) {
  const picker = (window as { showSaveFilePicker?: SavePicker })
    .showSaveFilePicker;
  if (!picker) {
    // shortcut: browsers without showSaveFilePicker (Firefox, Safari) buffer the whole file as a Blob, upgrade when they ship it or the API offers a signed download URL.
    const { filename, response } = await downloadReportExport(id);
    saveBlob(filename, await response.blob());
    return;
  }
  let file: Awaited<ReturnType<SavePicker>>;
  try {
    file = await picker({ suggestedName: `report-export-${id}.csv` });
  } catch (error) {
    // Cancelled by the person: nothing happens.
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw error;
  }
  const writable = await file.createWritable();
  try {
    const { response } = await downloadReportExport(id);
    if (!response.body) throw new Error("The export had no content");
    await response.body.pipeTo(writable);
  } catch (error) {
    await writable.abort(error).catch(() => undefined);
    throw error;
  }
}

export function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * `RP-10`: the export button's behaviour for any report. A small export downloads at once; a large
 * one is queued, and `panel` follows it until it can be downloaded from the authenticated route.
 */
export function useExportAction(start: () => Promise<ExportOutcome>): {
  run: () => void;
  pending: boolean;
  panel: ReactNode;
} {
  const { t } = useTranslation();
  const [exportId, setExportId] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: start,
    onSuccess: (outcome) => {
      if (outcome.kind === "file") saveBlob(outcome.filename, outcome.blob);
      else {
        setExportId(outcome.export.id);
        toast.info(t("reports:export.queuedToast"));
      }
    },
    onError: (error) =>
      toast.error(
        error instanceof HttpError && error.status === 429
          ? t("reports:export.tooMany")
          : error.message,
      ),
  });
  return {
    run: () => mutation.mutate(),
    pending: mutation.isPending,
    panel: exportId ? (
      <ReportExportStatus id={exportId} onDismiss={() => setExportId(null)} />
    ) : null,
  };
}

/** A queued export: waiting, running, ready to download, failed or expired. */
export function ReportExportStatus({
  id,
  onDismiss,
}: {
  id: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const exported = useReportExport(id);
  const download = useMutation({
    mutationFn: () => saveReportExport(id),
    onError: (error) => toast.error(error.message),
  });
  const info = exported.data?.data;
  const status = exported.isError ? "unavailable" : (info?.status ?? "queued");
  const waiting = status === "queued" || status === "running";
  return (
    <Alert
      variant={
        status === "ready"
          ? "success"
          : status === "failed" || status === "unavailable"
            ? "error"
            : "info"
      }
      data-testid="report-export-status"
    >
      <AlertTitle className="flex items-center gap-2">
        {waiting ? <Spinner aria-hidden="true" className="size-4" /> : null}
        {t(`reports:export.status.${status}.title`)}
      </AlertTitle>
      <AlertDescription>
        {t(`reports:export.status.${status}.description`, {
          count: info?.rowCount ?? 0,
          code: info?.error ?? "",
        })}
        {status === "ready" && info?.truncated ? (
          <span> {t("reports:export.truncated")}</span>
        ) : null}
      </AlertDescription>
      <AlertAction>
        {status === "ready" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={download.isPending}
            onClick={() => download.mutate()}
          >
            <Download aria-hidden="true" />
            {t("reports:export.download")}
          </Button>
        ) : null}
        {!waiting ? (
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            {t("reports:export.dismiss")}
          </Button>
        ) : null}
      </AlertAction>
    </Alert>
  );
}
