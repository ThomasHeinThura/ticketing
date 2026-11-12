import type { LucideIcon } from "lucide-react";
import {
  GitBranch,
  PiggyBank,
  Ruler,
  Settings,
  Tag,
  ToggleRight,
  Users,
  Zap,
} from "lucide-react";

type Translator = (key: string) => string;

export function getProjectSettingsMenuItems(
  t: Translator,
  access: {
    canManageProjectSettings: boolean;
    canManageFeatures?: boolean;
    canReadBudgets?: boolean;
    canReadEstimates?: boolean;
  },
): Array<{
  title: string;
  icon: LucideIcon;
  segment:
    | "general"
    | "workflow"
    | "labels"
    | "members"
    | "features"
    | "automations"
    | "estimates"
    | "budget";
}> {
  const items: ReturnType<typeof getProjectSettingsMenuItems> = [
    {
      title: t("settings:projectGeneral.title"),
      icon: Settings,
      segment: "general",
    },
    {
      title: t("settings:projectMembers.title"),
      icon: Users,
      segment: "members",
    },
    {
      title: t("settings:workspaceLabels.title"),
      icon: Tag,
      segment: "labels",
    },
    {
      title: t("settings:projectWorkflow.title"),
      icon: GitBranch,
      segment: "workflow",
    },
  ];
  // Features uses the selected project's own settings grant. Keep the existing Automations
  // navigation pending the separately tracked project-scoped automation capability.
  if (access.canManageFeatures ?? access.canManageProjectSettings)
    items.push({
      title: t("settings:projectFeatures.title"),
      icon: ToggleRight,
      segment: "features",
    });
  if (access.canManageProjectSettings)
    items.push({
      title: t("automations:project.navTitle"),
      icon: Zap,
      segment: "automations",
    });
  if (access.canReadEstimates || access.canManageProjectSettings)
    items.push({
      title: t("agile:estimates.navTitle"),
      icon: Ruler,
      segment: "estimates",
    });
  // Budget needs budget:read (members hold it, project settings rights are not required).
  if (access.canReadBudgets)
    items.push({
      title: t("timeTracking:budget.navTitle"),
      icon: PiggyBank,
      segment: "budget",
    });
  return items;
}
