import { Badge } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { WorkItemDetailField } from "@/types/work-item";

const FIELD_LABEL_KEYS: Record<WorkItemDetailField, string> = {
  key: "workItemExtras:detail.keyLabel",
  title: "workItemExtras:detail.titleLabel",
  priority: "workItemExtras:detail.priorityLabel",
  dueDate: "workItemExtras:detail.dueDateLabel",
  startDate: "workItemExtras:detail.startDateLabel",
  stateName: "workItemExtras:detail.stateLabel",
  createdAt: "workItemExtras:detail.createdLabel",
  updatedAt: "workItemExtras:detail.updatedLabel",
};

/** Renders a field marked unavailable by `parseWorkItemDetailRow` -- a visible
 * "Unavailable" badge plus a field-specific accessible label, e.g. "State unavailable". */
export default function UnavailableField({
  field,
}: {
  field: WorkItemDetailField;
}) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      aria-label={t("workItemExtras:detail.unavailableFieldLabel", {
        field: t(FIELD_LABEL_KEYS[field]),
      })}
    >
      {t("workItemExtras:detail.unavailable")}
    </Badge>
  );
}
