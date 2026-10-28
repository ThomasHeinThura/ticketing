import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { ProjectViewGroup } from "@/lib/project-board-search";

type GroupControlMenuProps<G extends ProjectViewGroup> = {
  group: G;
  groups: readonly G[];
  defaultLabel?: string;
  groupLabels?: Readonly<Record<string, string>>;
  onGroupChange: (group: G) => void;
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

export default function GroupControlMenu<G extends ProjectViewGroup>({
  group,
  groups,
  defaultLabel,
  groupLabels,
  onGroupChange,
}: GroupControlMenuProps<G>) {
  const { t } = useTranslation();
  const items = groups.map((entry) => ({
    group: entry,
    label:
      entry === "state" && defaultLabel
        ? defaultLabel
        : (groupLabels?.[entry] ?? t(`tasks:group.fields.${entry}`)),
  }));

  return (
    <DropdownMenuContent className="w-48" align="start">
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
          {t("tasks:group.by")}
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      {items.map((item) => (
        <DropdownMenuItem
          key={item.group}
          onClick={() => onGroupChange(item.group)}
          className="h-8 rounded-md text-sm"
        >
          <CheckSlot checked={group === item.group} />
          {item.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}
