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
  access: { canManageProjectSettings: boolean; canReadBudgets?: boolean },
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
  // Features and Automations need project:manage_settings (the server refuses them otherwise), so
  // the entries are not offered without it.
  if (access.canManageProjectSettings)
    items.push(
      {
        title: t("settings:projectFeatures.title"),
        icon: ToggleRight,
        segment: "features",
      },
      {
        title: t("automations:project.navTitle"),
        icon: Zap,
        segment: "automations",
      },
      {
        title: t("agile:estimates.navTitle"),
        icon: Ruler,
        segment: "estimates",
      },
    );
  // Budget needs budget:read (members hold it, project settings rights are not required).
  if (access.canReadBudgets)
    items.push({
      title: t("timeTracking:budget.navTitle"),
      icon: PiggyBank,
      segment: "budget",
    });
  return items;
}
