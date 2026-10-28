import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

/**
 * The standard empty state when a feature is switched off (404 from the API): the agile project
 * features, the Kaneo Calendar/Gantt views, and the workspace SLA settings (`sla`).
 */
export function FeatureOff({
  feature,
}: {
  feature: "cycles" | "modules" | "estimates" | "calendar" | "timeline" | "sla";
}) {
  const { t } = useTranslation("agile");
  return (
    <Empty data-testid={`feature-off-${feature}`}>
      <EmptyHeader>
        <EmptyTitle>{t(`featureOff.${feature}.title`)}</EmptyTitle>
        <EmptyDescription>
          {t(`featureOff.${feature}.description`)}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
