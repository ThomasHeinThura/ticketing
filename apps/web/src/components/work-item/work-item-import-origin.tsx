import { Badge } from "@taskdesk/ui";
import { ExternalLink, FileInput } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateMedium } from "@/lib/format";
import type { WorkItemDetailRow } from "@/types/work-item";

type Provenance = NonNullable<WorkItemDetailRow["importProvenance"]>[number];

/** Only http(s) is ever linked; the API already filters, this keeps the link safe on its own. */
function linkableUrl(value: string | null) {
  if (!value) return null;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function ProvenanceLine({ link }: { link: Provenance }) {
  const { t } = useTranslation();
  const url = linkableUrl(link.sourceUrl);
  const label = t(
    link.stale
      ? "workItems:properties.importedFromStale"
      : "workItems:properties.importedFrom",
    { system: link.system },
  );
  return (
    <div
      className="flex flex-col gap-0.5 px-2"
      data-testid="work-item-imported-from"
      data-stale={link.stale || undefined}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <FileInput
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex min-w-0 items-center gap-1 hover:underline"
            aria-label={t("workItems:properties.openSource", {
              system: link.system,
            })}
          >
            <span className="truncate">{label}</span>
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
          </a>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </span>
      <span className="pl-5 text-xs text-muted-foreground">
        {t("workItems:properties.importedOn", {
          date: formatDateMedium(link.importedAt),
        })}
      </span>
    </div>
  );
}

/**
 * "Imported from <system>" in the properties panel: where an imported item came from, with the link
 * to the original. Renders nothing for a native item (no provenance rows).
 */
export default function WorkItemImportOrigin({
  item,
}: {
  item: WorkItemDetailRow;
}) {
  const links = item.importProvenance ?? [];
  if (!links.length) return null;
  return (
    <div
      className="flex flex-col gap-1.5 py-2"
      data-testid="work-item-import-origin"
    >
      {links.map((link) => (
        <ProvenanceLine
          key={`${link.pluginId ?? ""}:${link.system}`}
          link={link}
        />
      ))}
    </div>
  );
}

/** The small "Imported" marker on an imported comment or history row. */
export function ImportedMarker({
  importedAt,
}: {
  importedAt: string | null | undefined;
}) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      size="sm"
      data-testid="imported-marker"
      title={
        importedAt
          ? t("activity:timeline.importedTitle", {
              date: formatDateMedium(importedAt),
            })
          : undefined
      }
    >
      {t("activity:timeline.imported")}
    </Badge>
  );
}
