import { Alert, AlertDescription, AlertTitle, Button } from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Holiday, ServiceCalendar } from "@/fetchers/service-calendar";
import { useImportServiceCalendarHolidays } from "@/hooks/mutations/service-calendar/use-import-service-calendar-holidays";

export function HolidayImportPanel({
  calendar,
  onImported,
}: {
  calendar: ServiceCalendar;
  onImported: (holidays: Holiday[]) => void;
}) {
  const { t } = useTranslation("serviceCalendars");
  const importer = useImportServiceCalendarHolidays();
  const [ics, setIcs] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    importedCount: number;
    duplicateCount: number;
  } | null>(null);
  const previewKeys = new Map<string, number>();
  const previewItems = names.map((name) => {
    const occurrence = previewKeys.get(name) ?? 0;
    previewKeys.set(name, occurrence + 1);
    return { name, key: `${name}-${occurrence}` };
  });

  function previewNames(text: string): string[] {
    const lines: string[] = [];
    for (const line of text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")) {
      if (line.startsWith(" ") || line.startsWith("\t")) {
        if (lines.length) lines[lines.length - 1] += line.slice(1);
      } else lines.push(line);
    }
    const names: string[] = [];
    let inEvent = false;
    let hasSummary = false;
    for (const line of lines) {
      if (line.toUpperCase() === "BEGIN:VEVENT") {
        inEvent = true;
        hasSummary = false;
      } else if (line.toUpperCase() === "END:VEVENT") {
        if (inEvent && !hasSummary) names.push(t("import.unnamed"));
        inEvent = false;
      } else if (inEvent && /^SUMMARY(?:;[^:]*)?:/i.test(line)) {
        const value = line.slice(line.indexOf(":") + 1);
        names.push(
          value
            .replace(/\\n/gi, " ")
            .replace(/\\([,;\\])/g, "$1")
            .normalize("NFC")
            .trim() || t("import.unnamed"),
        );
        hasSummary = true;
      }
    }
    return names;
  }

  async function handleFile(file?: File) {
    setError(null);
    setResult(null);
    setIcs(null);
    setNames([]);
    if (!file) return;
    try {
      if (file.size > 256 * 1024) throw new Error(t("import.tooLarge"));
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      const preview = previewNames(text);
      if (preview.length === 0) throw new Error(t("import.noEvents"));
      if (preview.length > 1000) throw new Error(t("import.tooMany"));
      setIcs(text);
      setNames(preview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("import.readError"));
    }
  }

  async function confirmImport() {
    if (!ics) return;
    setError(null);
    try {
      const imported = await importer.mutateAsync({
        id: calendar.id,
        version: calendar.version,
        ics,
      });
      setResult({
        importedCount: imported.importedCount,
        duplicateCount: imported.duplicateCount,
      });
      onImported(imported.calendar.holidays);
      setIcs(null);
      setNames([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("import.error"));
    }
  }

  return (
    <section
      className="space-y-3 rounded-md border p-4"
      aria-label={t("import.title")}
    >
      <div>
        <h3 className="font-medium">{t("import.title")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("import.description")}
        </p>
      </div>
      <label className="block space-y-1 text-sm">
        <span>{t("import.file")}</span>
        <input
          type="file"
          accept=".ics,text/calendar"
          aria-label={t("import.file")}
          onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
        />
      </label>
      {error ? (
        <Alert variant="error" role="alert">
          <AlertTitle>{t("import.errorTitle")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {names.length ? (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm font-medium">
            {t("import.preview", { count: names.length })}{" "}
          </p>
          <ul className="list-inside list-disc text-sm">
            {previewItems.map(({ name, key }) => (
              <li key={key}>{name}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t("import.confirmDescription")}
          </p>
          <Button
            type="button"
            disabled={importer.isPending}
            onClick={() => void confirmImport()}
          >
            {importer.isPending ? t("import.importing") : t("import.confirm")}
          </Button>
        </div>
      ) : null}
      {result ? (
        <Alert variant="info" role="status">
          <AlertTitle>{t("import.successTitle")}</AlertTitle>
          <AlertDescription>
            {t("import.success", {
              imported: result.importedCount,
              duplicates: result.duplicateCount,
            })}
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
