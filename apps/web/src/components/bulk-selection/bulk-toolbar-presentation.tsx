import {
  Button,
  Calendar,
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@taskdesk/ui";
import { ArrowDownToLine, CalendarIcon, Menu, X } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useUserPreferencesStore } from "@/store/user-preferences";

export type BulkActionItem = {
  value: string;
  label: string;
  icon?: ReactNode;
  onRun: () => void;
  disabled?: boolean;
};
export type BulkActionGroup = {
  value: string;
  label: string;
  items: BulkActionItem[];
};

/** Original Kaneo floating toolbar and command/calendar composition. Controllers
 * supply scoped capabilities and persisted actions; this component owns no API. */
export default function BulkToolbarPresentation({
  selectedCount,
  groupedItems,
  onClear,
  onMoveToBacklog,
  onDueDateChange,
  isActionsOpen,
  onActionsOpenChange,
  isDatePickerOpen,
  onDatePickerOpenChange,
  busy = false,
  children,
}: {
  selectedCount: number;
  groupedItems: BulkActionGroup[];
  onClear: () => void;
  onMoveToBacklog?: () => void;
  onDueDateChange?: (date: Date | undefined) => void;
  isActionsOpen: boolean;
  onActionsOpenChange: (open: boolean) => void;
  isDatePickerOpen: boolean;
  onDatePickerOpenChange: (open: boolean) => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  if (!selectedCount) return null;
  return (
    <div className="-translate-x-1/2 fixed bottom-6 left-1/2 z-50 transition-[translate,opacity] duration-200 ease-out starting:translate-y-3 starting:opacity-0 motion-reduce:starting:translate-y-0">
      <Toolbar
        aria-label={t("workItems:bulk.toolbarLabel")}
        className="items-center gap-1 rounded-xl border-border/80 bg-background px-1.5 py-1 shadow-lg/8"
      >
        <ToolbarGroup className="px-1.5">
          <span className="text-sm font-medium text-foreground">
            {t("tasks:bulk.selectedCount", { count: selectedCount })}
          </span>
        </ToolbarGroup>
        {onMoveToBacklog ? (
          <>
            <ToolbarSeparator orientation="vertical" className="my-1 h-5" />
            <ToolbarGroup>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onMoveToBacklog}
              >
                <ArrowDownToLine className="size-4" />
                {t("tasks:bulk.moveToBacklog")}
              </Button>
            </ToolbarGroup>
          </>
        ) : null}
        {onDueDateChange ? (
          <>
            <ToolbarSeparator orientation="vertical" className="my-1 h-5" />
            <ToolbarGroup>
              <Popover
                open={isDatePickerOpen}
                onOpenChange={onDatePickerOpenChange}
              >
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={busy}>
                    <CalendarIcon className="size-4" />
                    {t("tasks:bulk.setDueDate")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="center">
                  <Calendar
                    mode="single"
                    onSelect={onDueDateChange}
                    disabled={busy}
                    className="w-full bg-popover"
                    weekStartsOn={weekStartsOn}
                  />
                  <div className="p-0 border-t border-border">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground rounded-none"
                      onClick={() => onDueDateChange(undefined)}
                    >
                      <X className="h-4 w-4" />
                      {t("tasks:dueDate.clear")}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </ToolbarGroup>
          </>
        ) : null}
        {groupedItems.length ? (
          <>
            <ToolbarSeparator orientation="vertical" className="my-1 h-5" />
            <ToolbarGroup>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onActionsOpenChange(true)}
              >
                <Menu className="size-4" />
                {t("tasks:bulk.actions")}
              </Button>
            </ToolbarGroup>
          </>
        ) : null}
        <ToolbarSeparator orientation="vertical" className="my-1 h-5" />
        <ToolbarGroup>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onClear}
            aria-label={t("workItems:bulk.clear")}
          >
            <X className="size-4" />
          </Button>
        </ToolbarGroup>
      </Toolbar>
      {children}
      <CommandDialog open={isActionsOpen} onOpenChange={onActionsOpenChange}>
        <CommandDialogPopup instant>
          <Command items={groupedItems}>
            <CommandInput placeholder={t("tasks:bulk.searchActions")} />
            <CommandPanel>
              <CommandEmpty>{t("tasks:bulk.noActionsFound")}</CommandEmpty>
              <CommandList>
                {(group: BulkActionGroup, index: number) => (
                  <Fragment key={group.value}>
                    <CommandGroup items={group.items}>
                      <CommandGroupLabel>{group.label}</CommandGroupLabel>
                      <CommandCollection>
                        {(item: BulkActionItem) => (
                          <CommandItem
                            key={item.value}
                            value={item.value}
                            disabled={busy || item.disabled}
                            onClick={() => {
                              if (!busy && !item.disabled) item.onRun();
                            }}
                            className="gap-1.5 px-3"
                          >
                            <span aria-hidden="true" className="shrink-0">
                              {item.icon}
                            </span>
                            <span className="flex-1 text-sm">{item.label}</span>
                          </CommandItem>
                        )}
                      </CommandCollection>
                    </CommandGroup>
                    {index < groupedItems.length - 1 ? (
                      <CommandSeparator />
                    ) : null}
                  </Fragment>
                )}
              </CommandList>
            </CommandPanel>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>
    </div>
  );
}
