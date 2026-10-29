import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@taskdesk/ui";
import { type ReactElement, useId, useState } from "react";

/** Keep the original control and its ref while using Kaneo's tooltip surface. */
export function ActionTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const existingDescription = (
    children.props as { "aria-describedby"?: string }
  )["aria-describedby"];
  return (
    <TooltipProvider>
      <Tooltip onOpenChange={setOpen}>
        <TooltipTrigger
          asChild
          aria-describedby={
            open
              ? [existingDescription, tooltipId].filter(Boolean).join(" ")
              : existingDescription
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent id={tooltipId} role="tooltip">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
