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
import { ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Original Kaneo task breadcrumb, with data and navigation supplied by its controller. */
export function TaskCrumbPresentation({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="h-7 max-w-56 justify-between gap-1.5 px-2 text-xs text-foreground"
          />
        }
      >
        <span className="truncate text-left">
          {label || t("tasks:common.selectTask")}
        </span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      {open ? children : null}
    </DropdownMenu>
  );
}

export function TaskCrumbOptionsPresentation({
  options,
  onSelect,
  children,
  empty = true,
}: {
  options: { value: string; label: string; disabled?: boolean }[];
  onSelect: (value: string) => void;
  children?: ReactNode;
  empty?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenuContent className="w-80" align="start">
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
          {t("navigation:search.groups.task")}
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            disabled={option.disabled}
            onClick={() => onSelect(option.value)}
            className="h-8 gap-2 text-sm"
          >
            <span className="min-w-0 truncate text-foreground">
              {option.label}
            </span>
          </DropdownMenuItem>
        ))}
        {empty && options.length === 0 ? (
          <DropdownMenuItem
            disabled
            className="h-8 text-sm text-muted-foreground"
          >
            {t("tasks:listView.noTasks")}
          </DropdownMenuItem>
        ) : null}
        {children}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}
