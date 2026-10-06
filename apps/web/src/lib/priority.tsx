import {
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleAlert,
  Minus,
} from "lucide-react";
import type { ReactNode } from "react";

const PRIORITY_ICONS: Record<string, ReactNode> = {
  urgent: (
    <CircleAlert className="h-[12px] w-[12px] text-destructive-foreground" />
  ),
  high: <ChevronsUp className="h-[12px] w-[12px] text-warning-foreground" />,
  medium: (
    <ChevronUp className="h-[12px] w-[12px] text-warning-foreground/80" />
  ),
  low: <ChevronDown className="h-[12px] w-[12px] text-info-foreground/85" />,
  "no-priority": <Minus className="h-[12px] w-[12px] text-muted-foreground" />,
};

export function getPriorityIcon(priority: string) {
  return PRIORITY_ICONS[priority] ?? PRIORITY_ICONS["no-priority"];
}
