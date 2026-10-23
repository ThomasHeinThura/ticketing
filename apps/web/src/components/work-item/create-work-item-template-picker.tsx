import { Button, Popover, PopoverContent, PopoverTrigger } from "@taskdesk/ui";
import { Check, LayoutTemplate } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CREATE_TASK_PROPERTY_BUTTON_CLASS,
  CREATE_TASK_PROPERTY_OPTION_CLASS,
} from "@/components/shared/modals/create-task-presentation";
import useWorkItemTemplateOptions from "@/hooks/queries/work-item-template/use-work-item-template-options";
import { cn } from "@/lib/cn";

export type CreateWorkItemTemplate = {
  id: string;
  name: string;
  typeId: string;
  title: string;
};

/**
 * `WI-5`: starts a new work item from a workspace template. Renders nothing until the workspace
 * has at least one live template, so a workspace without templates sees the unchanged dialog.
 * Choosing one hands its type and starting title to the form; the server copies description,
 * labels and checklist at creation and never the assignee or dates.
 */
export default function CreateWorkItemTemplatePicker({
  workspaceId,
  selectedId,
  disabled,
  onSelect,
}: {
  workspaceId: string | undefined;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (template: CreateWorkItemTemplate | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const templates = useWorkItemTemplateOptions(workspaceId);
  const rows = templates.data ?? [];
  if (!rows.length) return null;
  const selected = rows.find((row) => row.id === selectedId);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t("workItems:create.fieldTemplate")}
          className={cn(
            CREATE_TASK_PROPERTY_BUTTON_CLASS,
            selected ? "bg-accent/30 text-foreground" : "text-muted-foreground",
          )}
          disabled={disabled}
          data-testid="create-work-item-template-trigger"
        >
          <LayoutTemplate className="w-3.5 h-3.5" />
          <span>
            {selected?.name ?? t("workItems:create.templatePlaceholder")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="space-y-1">
          <Button
            type="button"
            variant="ghost"
            className={CREATE_TASK_PROPERTY_OPTION_CLASS}
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
          >
            <span className="text-sm truncate">
              {t("workItems:create.templateNone")}
            </span>
            {selectedId === null ? (
              <Check className="ml-auto h-4 w-4 shrink-0" />
            ) : null}
          </Button>
          {rows.map((row) => (
            <Button
              key={row.id}
              type="button"
              variant="ghost"
              className={CREATE_TASK_PROPERTY_OPTION_CLASS}
              onClick={() => {
                onSelect(row);
                setOpen(false);
              }}
            >
              <span className="text-sm truncate">{row.name}</span>
              {selectedId === row.id ? (
                <Check className="ml-auto h-4 w-4 shrink-0" />
              ) : null}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
