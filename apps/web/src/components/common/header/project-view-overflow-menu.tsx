import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@taskdesk/ui";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "@/components/common/action-tooltip";
import { cn } from "@/lib/cn";

export type ProjectViewOverflowItem = {
  view: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  disabledReason?: string;
  onSelect: () => void;
};

/**
 * The "More" menu after the project tab strip: it lists the tabs the strip cannot show at the
 * current width, so every view stays one click away. It composes the header "…" menu's
 * pieces (the same DropdownMenu, item height and icon colour).
 */
export default function ProjectViewOverflowMenu({
  items,
}: {
  items: readonly ProjectViewOverflowItem[];
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            aria-label={t("navigation:projectViews.moreLabel")}
            data-testid="project-view-overflow-trigger"
            className="h-8 shrink-0 gap-1 rounded-lg border border-border/80 bg-background px-2 text-muted-foreground text-xs hover:text-foreground"
          />
        }
      >
        {t("navigation:sidebar.more")}
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-44 rounded-lg" align="end">
        {items.map(
          ({ view, label, icon: Icon, active, disabledReason, onSelect }) => {
            const item = (
              <DropdownMenuItem
                key={view}
                aria-disabled={disabledReason ? "true" : undefined}
                aria-description={disabledReason}
                className={cn(
                  "h-7 cursor-pointer text-sm",
                  active && "bg-accent text-accent-foreground",
                  disabledReason && "cursor-not-allowed opacity-64",
                )}
                aria-current={active ? "page" : undefined}
                onClickCapture={
                  disabledReason
                    ? (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    : undefined
                }
                onKeyDownCapture={
                  disabledReason
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                        }
                      }
                    : undefined
                }
                onClick={disabledReason ? undefined : onSelect}
              >
                <Icon className="text-muted-foreground" />
                <span>{label}</span>
              </DropdownMenuItem>
            );
            return disabledReason ? (
              <ActionTooltip key={view} label={disabledReason}>
                {item}
              </ActionTooltip>
            ) : (
              item
            );
          },
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
