import { Link } from "@tanstack/react-router";
import {
  type EmptyStateAction,
  type EmptyStateProps,
  FeatureOff as SharedFeatureOff,
} from "@taskdesk/ui";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { routes } from "@/lib/routes";
import {
  useCanManageProjectFeatures,
  useCanManageProjectFeaturesById,
} from "./use-can-manage-project-features";

type OffFeature =
  | "cycles"
  | "modules"
  | "estimates"
  | "calendar"
  | "timeline"
  | "sla"
  | "pages";

/** The project features a project settings manager can switch on (`sla` is a workspace switch). */
type ProjectOffFeature = Exclude<OffFeature, "sla">;

/**
 * Level of the off state's title. Default 2: the off state sits under the page's own `h1`. Pass 1
 * when the off state *is* the page (the project shell has no `h1` of its own), so every page keeps
 * exactly one.
 */
type HeadingLevelProp = { headingLevel?: EmptyStateProps["headingLevel"] };

/**
 * The standard empty state when a feature is switched off (404 from the API): the agile project
 * features, the Kaneo Calendar/Gantt views, project Pages, and the workspace SLA settings (`sla`).
 * Built on the shared `FeatureOff` (UX-1a); `manage` adds the settings link and its wording, and
 * is passed only when the viewer can switch the feature on.
 */
export function FeatureOff({
  feature,
  manage,
  headingLevel,
}: HeadingLevelProp & {
  feature: OffFeature;
  manage?: { label: string; render: ReactElement };
}) {
  const { t } = useTranslation("agile");
  const action: EmptyStateAction | undefined = manage;
  return (
    <SharedFeatureOff
      data-testid={`feature-off-${feature}`}
      title={t(`featureOff.${feature}.title`)}
      description={
        manage
          ? t(`featureOff.${feature}.manageDescription`)
          : t(`featureOff.${feature}.description`)
      }
      action={action}
      headingLevel={headingLevel}
    />
  );
}

/** A project feature's off state, with "Open feature settings" for project settings managers. */
export function ProjectFeatureOff({
  feature,
  projectKey,
  headingLevel,
}: HeadingLevelProp & {
  feature: ProjectOffFeature;
  projectKey: string;
}) {
  const { t } = useTranslation("agile");
  const canManage = useCanManageProjectFeatures(projectKey);
  return (
    <FeatureOff
      feature={feature}
      headingLevel={headingLevel}
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

/**
 * The same, for the Kaneo screens that know the project by id (Calendar and Gantt views), which
 * open the id-based feature settings route.
 */
export function ProjectIdFeatureOff({
  feature,
  projectId,
  workspaceId,
  headingLevel,
}: HeadingLevelProp & {
  feature: ProjectOffFeature;
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation("agile");
  const canManage = useCanManageProjectFeaturesById(projectId, workspaceId);
  return (
    <FeatureOff
      feature={feature}
      headingLevel={headingLevel}
      manage={
        canManage
          ? {
              label: t("featureOff.openSettings"),
              render: (
                <Link
                  to={routes.projectSettingsFeatures.path}
                  params={{ projectId }}
                />
              ),
            }
          : undefined
      }
    />
  );
}
