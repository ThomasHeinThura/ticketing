import {
  Badge,
  Button,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@taskdesk/ui";
import { CalendarIcon, Check, UserIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/avatar";
import {
  CREATE_TASK_PROPERTY_BUTTON_CLASS,
  CREATE_TASK_PROPERTY_OPTION_CLASS,
  CreateTaskPropertyRow,
} from "@/components/shared/modals/create-task-presentation";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { resolveLabelColor } from "@/lib/label-color";
import { useUserPreferencesStore } from "@/store/user-preferences";
import CreateWorkItemLabelPicker from "./create-work-item-label-picker";
import type {
  CreateWorkItemLabel,
  CreateWorkItemOptions,
} from "./use-create-work-item-options";

type Props = {
  workspaceId: string | undefined;
  projectId: string;
  onLabelCreated: (label: CreateWorkItemLabel) => void;
  onLabelBusyChange: (busy: boolean) => void;
  onLabelDraftChange: (dirty: boolean) => void;
  options: CreateWorkItemOptions;
  typeControl: ReactNode;
  priorityControl: ReactNode;
  startDate: Date | undefined;
  dueDate: Date | undefined;
  assigneeId: string;
  labelIds: string[];
  onStartDateChange: (day: Date | undefined) => void;
  onDueDateChange: (day: Date | undefined) => void;
  onAssigneeChange: (id: string) => void;
  onLabelsChange: (ids: string[]) => void;
  canUpdate: boolean;
  canAssign: boolean;
  disabled: boolean;
};
/** Kaneo create-modal chip composition, backed by canonical project catalogues. */
export default function CreateWorkItemProperties(props: Props) {
  const { t } = useTranslation();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const { options, assigneeId, labelIds, canUpdate, canAssign, disabled } =
    props;
  const selectedPerson = options.people.find(
    (person) => person.personId === assigneeId,
  );
  const defaultState = options.states.find((state) => state.isDefault);
  const selectedLabels = options.labels.filter((label) =>
    labelIds.includes(label.id),
  );
  const dateChip = (
    kind: "startDate" | "dueDate",
    day: Date | undefined,
    onChange: (day: Date | undefined) => void,
  ) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t(`common:modals.createTask.${kind}`)}
          data-testid={`create-work-item-${kind}-trigger`}
          disabled={disabled || !canUpdate}
          className={cn(
            CREATE_TASK_PROPERTY_BUTTON_CLASS,
            day ? "bg-accent/30 text-foreground" : "text-muted-foreground",
          )}
        >
          <CalendarIcon className="w-3.5 h-3.5" />
          <span>
            {day
              ? formatDateMedium(day)
              : t(`common:modals.createTask.${kind}`)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Calendar
          mode="single"
          selected={day}
          onSelect={onChange}
          className="w-full bg-popover"
          weekStartsOn={weekStartsOn}
          disabled={disabled || !canUpdate}
        />
        {day ? (
          <div className="p-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs"
              disabled={disabled || !canUpdate}
              onClick={() => onChange(undefined)}
            >
              {t(
                `common:modals.createTask.${kind === "startDate" ? "clearStartDate" : "clearDueDate"}`,
              )}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
  return (
    <>
      {selectedLabels.length > 0 ? (
        <div className="flex flex-wrap mb-2">
          {selectedLabels.map((label) => (
            <Badge
              key={label.id}
              color={label.color}
              variant="outline"
              className="flex items-center gap-1 pl-3 cursor-pointer hover:bg-accent/50 transition-colors"
              render={
                // ui-exempt: Badge owns Kaneo styling; its render host needs native button semantics for keyboard label removal and disabled state.
                <button
                  type="button"
                  disabled={disabled || !canUpdate}
                  aria-label={`${t("common:modals.createTask.labels")}: ${label.name}`}
                  onClick={() =>
                    props.onLabelsChange(
                      labelIds.filter((id) => id !== label.id),
                    )
                  }
                />
              }
            >
              <span
                className="inline-block w-2 h-2 mr-1.5 rounded-full"
                style={{ backgroundColor: resolveLabelColor(label.color) }}
              />
              <span className="max-w-20 truncate">{label.name}</span>
            </Badge>
          ))}
        </div>
      ) : null}
      <CreateTaskPropertyRow>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent/50 text-foreground rounded-md text-xs font-medium border border-border"
          role="status"
          data-testid="create-work-item-default-state"
          aria-label={t("tasks:status.label")}
        >
          <div className="w-1.5 h-1.5 bg-foreground rounded-full" />
          {defaultState?.name ??
            t(
              options.statesError
                ? "workItems:journey.transitionsError"
                : "common:empty.loading",
            )}
        </div>
        {props.typeControl}
        {dateChip("startDate", props.startDate, props.onStartDateChange)}
        {props.priorityControl}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label={t("common:modals.createTask.assign")}
              data-testid="create-work-item-assignee-trigger"
              disabled={
                disabled ||
                (!canAssign && !canUpdate) ||
                options.peopleLoading ||
                options.peopleError
              }
              className={cn(
                CREATE_TASK_PROPERTY_BUTTON_CLASS,
                selectedPerson
                  ? "bg-accent/30 text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {selectedPerson ? (
                <>
                  <Avatar className="h-4 w-4">
                    <AvatarFallback className="text-[10px] font-medium border border-border/30">
                      {getInitials(selectedPerson.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span>
                    {selectedPerson.name ??
                      t("workItems:journey.unnamedPerson")}
                  </span>
                </>
              ) : (
                <>
                  <UserIcon className="w-3.5 h-3.5" />
                  <span>{t("common:modals.createTask.assign")}</span>
                </>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            <div className="space-y-1">
              <Button
                type="button"
                variant="ghost"
                className={CREATE_TASK_PROPERTY_OPTION_CLASS}
                disabled={disabled}
                onClick={() => props.onAssigneeChange("")}
              >
                <UserIcon className="w-3.5 h-3.5" />
                {t("common:modals.createTask.assignUnassigned")}
                {!assigneeId ? <Check className="ml-auto h-4 w-4" /> : null}
              </Button>
              {options.people.map((person) => (
                <Button
                  type="button"
                  variant="ghost"
                  key={person.personId}
                  aria-label={
                    person.name ?? t("workItems:journey.unnamedPerson")
                  }
                  className={CREATE_TASK_PROPERTY_OPTION_CLASS}
                  disabled={disabled}
                  onClick={() => props.onAssigneeChange(person.personId)}
                >
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs font-medium border border-border/30">
                      {getInitials(person.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm truncate">
                    {person.name ?? t("workItems:journey.unnamedPerson")}
                  </span>
                  {person.personId === assigneeId ? (
                    <Check className="ml-auto h-4 w-4" />
                  ) : null}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {dateChip("dueDate", props.dueDate, props.onDueDateChange)}
        <CreateWorkItemLabelPicker
          workspaceId={props.workspaceId}
          projectId={props.projectId}
          labels={options.labels}
          labelIds={labelIds}
          onChange={props.onLabelsChange}
          onCreated={props.onLabelCreated}
          onBusyChange={props.onLabelBusyChange}
          onDraftChange={props.onLabelDraftChange}
          canUpdate={canUpdate}
          disabled={disabled}
          loading={options.labelsLoading}
          error={options.labelsError}
        />
      </CreateTaskPropertyRow>
      {options.peopleError && (canAssign || canUpdate) ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("workItems:journey.peopleError")}
        </p>
      ) : null}
      {options.labelsError && canUpdate ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("tasks:popover.labels.updateError")}
        </p>
      ) : null}
    </>
  );
}
