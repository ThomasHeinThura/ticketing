import { Badge } from "@taskdesk/ui";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Board column count (`VW-12`). With a work-in-progress limit it reads "count / limit" and turns
 * amber past it. Amber is never the only signal: an icon and the accessible name say the limit
 * is exceeded. It never blocks a drop; the limit only informs.
 */
export default function ColumnCountBadge({
  total,
  limit,
  state,
}: {
  total: number;
  limit?: number;
  state: string;
}) {
  const { t } = useTranslation();
  if (limit === undefined)
    return (
      <span
        role="img"
        className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
        aria-label={t("workItems:board.columnCount", { total, state })}
      >
        {total}
      </span>
    );
  const exceeded = total > limit;
  return (
    <Badge
      role="img"
      variant={exceeded ? "warning" : "outline"}
      data-wip-exceeded={exceeded ? "true" : "false"}
      aria-label={t(
        exceeded
          ? "workItems:board.columnCountOverLimit"
          : "workItems:board.columnCountWithLimit",
        { total, limit, state },
      )}
    >
      {exceeded ? (
        <TriangleAlert aria-hidden="true" className="size-3" />
      ) : null}
      {total} / {limit}
    </Badge>
  );
}
