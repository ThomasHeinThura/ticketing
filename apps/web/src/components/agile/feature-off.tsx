import { Link } from "@tanstack/react-router";
import { FeatureOff as SharedFeatureOff } from "@taskdesk/ui";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { routes } from "@/lib/routes";
import { useCanManageProjectFeatures } from "./use-can-manage-project-features";

type OffFeature =
  | "cycles"
  | "modules"
  | "estimates"
  | "calendar"
  | "timeline"
  | "sla"
  | "pages";

/** Features whose off state has wording for someone who can switch them on. */
type ManageableFeature = "cycles" | "modules" | "sla";

/**
 * The standard empty state when a feature is switched off (404 from the API): the agile project
 * features, the Kaneo Calendar/Gantt views, project Pages, and the workspace SLA settings (`sla`).
 * Built on the shared `FeatureOff` (UX-1a); `manage` adds the settings link and its wording, and
 * is passed only when the viewer can switch the feature on.
 */
export function FeatureOff(
  props:
    | { feature: OffFeature; manage?: undefined }
    | {
        feature: ManageableFeature;
        manage?: { label: string; render: ReactElement };
      },
) {
  const { feature, manage } = props;
  const { t } = useTranslation("agile");
  return (
    <SharedFeatureOff
      data-testid={`feature-off-${feature}`}
      title={t(`featureOff.${feature}.title`)}
      description={
        manage
          ? t(`featureOff.${feature}.manageDescription`)
          : t(`featureOff.${feature}.description`)
      }
      action={manage}
    />
  );
}

/** A project feature's off state, with "Open feature settings" for project settings managers. */
export function ProjectFeatureOff({
  feature,
  projectKey,
}: {
  feature: "cycles" | "modules";
  projectKey: string;
}) {
  const { t } = useTranslation("agile");
  const canManage = useCanManageProjectFeatures(projectKey);
  return (
    <FeatureOff
      feature={feature}
      manage={
        canManage
          ? {
              label: t("featureOff.openSettings"),
              render: (
                <Link
                  to={routes.projectFeatures.path}
                  params={{ projectKey }}
                />
              ),
            }
          : undefined
      }
    />
  );
}
