import { Badge } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { WorkItemDetailField } from "@/types/work-item";

const FIELD_LABEL_KEYS: Record<WorkItemDetailField, string> = {
  key: "workItems:detail.keyLabel",
  title: "workItems:detail.titleLabel",
  priority: "workItems:detail.priorityLabel",
  dueDate: "workItems:detail.dueDateLabel",
  startDate: "workItems:detail.startDateLabel",
  stateName: "workItems:detail.stateLabel",
  createdAt: "workItems:detail.createdLabel",
  updatedAt: "workItems:detail.updatedLabel",
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
      aria-label={t("workItems:detail.unavailableFieldLabel", {
        field: t(FIELD_LABEL_KEYS[field]),
      })}
    >
      {t("workItems:detail.unavailable")}
    </Badge>
  );
}
