import {
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleAlert,
  Minus,
} from "lucide-react";
import type { ReactNode } from "react";

type Priority = "urgent" | "high" | "medium" | "low" | "no-priority";

const priorityIcons = new Map<Priority, ReactNode>();
const PRIORITIES = new Set<Priority>([
  "urgent",
  "high",
  "medium",
  "low",
  "no-priority",
]);

export function getPriorityIcon(priority: string) {
  const key: Priority = isPriority(priority) ? priority : "no-priority";
  const cached = priorityIcons.get(key);
  if (cached) return cached;

  const icon = (() => {
    switch (key) {
      case "urgent":
        return <CircleAlert className="h-[12px] w-[12px] text-current" />;
      case "high":
        return <ChevronsUp className="h-[12px] w-[12px] text-current" />;
      case "medium":
        return <ChevronUp className="h-[12px] w-[12px] text-current" />;
      case "low":
        return <ChevronDown className="h-[12px] w-[12px] text-current" />;
      case "no-priority":
        return <Minus className="h-[12px] w-[12px] text-current" />;
    }
  })();

  priorityIcons.set(key, icon);
  return icon;
}

function isPriority(value: string): value is Priority {
  return PRIORITIES.has(value as Priority);
}
