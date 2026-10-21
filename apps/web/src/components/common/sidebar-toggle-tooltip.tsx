import {
  KbdSequence,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@taskdesk/ui";
import type { ReactElement } from "react";
import { shortcuts } from "@/constants/shortcuts";

/** Kaneo's "Toggle sidebar" tooltip with its keyboard sequence, around the header trigger. */
export default function SidebarToggleTooltip({
  children,
}: {
  children: ReactElement;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>
          <p className="flex items-center gap-2 text-[10px]">
            Toggle sidebar
            <KbdSequence
              keys={[shortcuts.sidebar.prefix, shortcuts.sidebar.toggle]}
            />
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
