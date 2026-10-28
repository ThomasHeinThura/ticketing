import {
  Calendar,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@taskdesk/ui";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import { getColumnIcon } from "@/lib/column";
import { getInitials } from "@/lib/get-initials";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";

export type TaskMenuPerson = {
  value: string;
  label: string;
  name: string;
  image?: string;
};
/** Original Kaneo context-menu presentation; controllers provide authorized real actions. */
export default function TaskContextMenuPresentation({
  onCopyLink,
  keyboardAnchor,
  priority,
  states,
  dueDate,
  assignee,
  onArchive,
  extraArchiveAction,
  onDelete,
  disabled = false,
  status,
}: {
  onCopyLink: () => void;
  keyboardAnchor?: ComponentProps<typeof ContextMenuContent>["anchor"];
  priority?: { value: string | null; onChange: (value: string) => void };
  states?: {
    value: string;
    options: {
      value: string;
      name: string;
      icon?: string | null;
      isFinal?: boolean;
      disabled?: boolean;
    }[];
    onChange: (value: string) => void;
    emptyLabel?: string;
  };
  dueDate?: {
    value: Date | undefined;
    onChange: (value: Date | undefined) => void;
    weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  };
  assignee?: {
    value: string | null;
    options: TaskMenuPerson[];
    onChange: (value: string) => void;
    canUnassign?: boolean;
    emptyLabel?: string;
  };
  onArchive?: () => void;
  extraArchiveAction?: ReactNode;
  onDelete?: () => void;
  disabled?: boolean;
  status?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <ContextMenuContent className="w-46" anchor={keyboardAnchor}>
      <ContextMenuItem onClick={onCopyLink}>
        <span>{t("tasks:contextMenu.copyLink")}</span>
      </ContextMenuItem>
      {status}
      {priority || states || dueDate || assignee ? (
        <ContextMenuSeparator />
      ) : null}
      {priority ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2" disabled={disabled}>
            <span>{t("tasks:priority.label")}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            {["no-priority", "low", "medium", "high", "urgent"].map((value) => (
              <ContextMenuCheckboxItem
                key={value}
                checked={(priority.value ?? "no-priority") === value}
                onCheckedChange={() => priority.onChange(value)}
                closeOnClick
                className="[&_svg]:text-muted-foreground"
                disabled={disabled}
              >
                {getPriorityIcon(value)}
                <span
                  className={value === "no-priority" ? undefined : "capitalize"}
                >
                  {getPriorityLabel(value)}
                </span>
              </ContextMenuCheckboxItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      {states ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={disabled}>
            <span>{t("tasks:status.label")}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            {states.options.map((state) => (
              <ContextMenuCheckboxItem
                key={state.value}
                checked={states.value === state.value}
                onCheckedChange={() => states.onChange(state.value)}
                closeOnClick
                className="[&_svg]:text-muted-foreground"
                disabled={disabled || state.disabled}
              >
                {getColumnIcon(state.value, state.isFinal ?? false, state.icon)}
                <span>{state.name}</span>
              </ContextMenuCheckboxItem>
            ))}
            {states.options.length === 0 && states.emptyLabel ? (
              <ContextMenuItem disabled>{states.emptyLabel}</ContextMenuItem>
            ) : null}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      {dueDate ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={disabled}>
            <span>{t("tasks:dueDate.label")}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-fit min-w-0 p-0">
            <div className="p-2">
              <Calendar
                mode="single"
                selected={dueDate.value}
                onSelect={dueDate.onChange}
                className="w-full bg-popover!"
                weekStartsOn={dueDate.weekStartsOn}
                disabled={disabled}
              />
            </div>
            {dueDate.value ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="gap-2 text-muted-foreground"
                  onClick={() => dueDate.onChange(undefined)}
                  disabled={disabled}
                >
                  <X className="h-4 w-4" />
                  <span>{t("tasks:dueDate.clear")}</span>
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      {assignee ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={disabled}>
            <span>{t("tasks:assignee.label")}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuCheckboxItem
              checked={!assignee.value}
              onCheckedChange={() => assignee.onChange("")}
              closeOnClick
              disabled={disabled || assignee.canUnassign === false}
            >
              <div
                className="w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center"
                title={t("tasks:assignee.unassigned")}
              >
                <span className="text-[10px] font-medium text-muted-foreground">
                  ?
                </span>
              </div>
              {t("tasks:assignee.unassigned")}
            </ContextMenuCheckboxItem>
            {assignee.options.map((person) => (
              <ContextMenuCheckboxItem
                key={person.value}
                checked={assignee.value === person.value}
                onCheckedChange={() => assignee.onChange(person.value)}
                closeOnClick
                disabled={disabled}
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage
                    src={person.image ?? ""}
                    alt={person.name || ""}
                  />
                  <AvatarFallback className="text-xs font-medium border border-border/30">
                    {getInitials(person.name)}
                  </AvatarFallback>
                </Avatar>
                {person.label}
              </ContextMenuCheckboxItem>
            ))}
            {assignee.options.length === 0 && assignee.emptyLabel ? (
              <ContextMenuItem disabled>{assignee.emptyLabel}</ContextMenuItem>
            ) : null}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      {onArchive ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onArchive} disabled={disabled}>
            <span>{t("tasks:actions.archive")}</span>
          </ContextMenuItem>
          {extraArchiveAction}
        </>
      ) : null}
      {onDelete ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive"
            disabled={disabled}
            onClick={(event) => {
              event.preventDefault();
              onDelete();
            }}
          >
            <span>{t("tasks:actions.delete")}</span>
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  );
}
