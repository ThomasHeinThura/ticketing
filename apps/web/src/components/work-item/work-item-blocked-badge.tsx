import { Badge } from "@taskdesk/ui";
import { Ban } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * `RH-17`: a work item with an open `blocked_by` relation shows a badge (the relations
 * section lists what is blocking it). Renders nothing for an unblocked item or for a
 * producer that does not resolve `blockedByOpenCount`. Kaneo `Badge`, `warning` variant.
 */
export function WorkItemBlockedBadge({
  blockedByOpenCount,
  className,
}: {
  blockedByOpenCount: number | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!blockedByOpenCount || blockedByOpenCount < 1) return null;
  return (
    <Badge
      variant="warning"
      className={className}
      data-testid="work-item-blocked-badge"
      title={t("workItems:blocked.badgeTitle")}
    >
      <Ban aria-hidden="true" className="size-3" />
      {t("workItems:blocked.badge")}
    </Badge>
  );
}

export default WorkItemBlockedBadge;
