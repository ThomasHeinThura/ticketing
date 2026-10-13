import type { LucideIcon } from "lucide-react";
import { GitBranch, Settings } from "lucide-react";

type Translator = (key: string) => string;

export function getProjectSettingsMenuItems(t: Translator): Array<{
  title: string;
  icon: LucideIcon;
  segment: "general" | "workflow";
}> {
  return [
    {
      title: t("settings:projectGeneral.title"),
      icon: Settings,
      segment: "general",
    },
    {
      title: t("settings:projectWorkflow.title"),
      icon: GitBranch,
      segment: "workflow",
    },
  ];
}
