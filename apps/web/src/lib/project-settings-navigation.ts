import type { LucideIcon } from "lucide-react";
import { GitBranch, Settings, Tag } from "lucide-react";

type Translator = (key: string) => string;

export function getProjectSettingsMenuItems(t: Translator): Array<{
  title: string;
  icon: LucideIcon;
  segment: "general" | "workflow" | "labels";
}> {
  return [
    {
      title: t("settings:projectGeneral.title"),
      icon: Settings,
      segment: "general",
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
}
