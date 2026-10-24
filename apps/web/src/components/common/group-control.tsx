import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@taskdesk/ui";
import { Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProjectViewGroup } from "@/lib/project-board-search";

type GroupControlProps<G extends ProjectViewGroup> = {
  group: G;
  onGroupChange: (group: G) => void;
  /** The groupings this view supports, in menu order. */
  groups: readonly G[];
  /**
   * What the default grouping (`state`) is called. The board names it "Status"; a view with no
   * state grouping, such as the timeline, shows it as "None".
   */
  defaultLabel?: string;
};

function CheckSlot({ checked }: { checked: boolean }) {
  return (
    <span
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border ${
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background"
      }`}
    >
      {checked ? "✓" : null}
    </span>
  );
}

/**
 * `VW-13` / `VW-27`: the toolbar's "Group" menu. Same menu, trigger and check slot as the
 * Sort control beside it; the default grouping (state) reads as "no grouping chosen".
 */
export default function GroupControl<G extends ProjectViewGroup>({
  group,
  onGroupChange,
  groups,
  defaultLabel,
}: GroupControlProps<G>) {
  const { t } = useTranslation();
  const isActive = group !== "state";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            type="button"
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none ring-0 ${
              isActive
                ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-border bg-background text-foreground hover:bg-accent/60"
            }`}
          />
        }
      >
        <Layers className="h-3 w-3" />
        {isActive ? t(`tasks:group.fields.${group}`) : t("tasks:group.label")}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
            {t("tasks:group.by")}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {groups.map((entry) => (
          <DropdownMenuItem
            key={entry}
            onClick={() => onGroupChange(entry)}
            className="h-8 rounded-md text-sm"
          >
            <CheckSlot checked={group === entry} />
            {entry === "state" && defaultLabel
              ? defaultLabel
              : t(`tasks:group.fields.${entry}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
