import { Button, Popover, PopoverContent, PopoverTrigger } from "@taskdesk/ui";
import { Check, ChevronDown } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { CREATE_TASK_PROPERTY_OPTION_CLASS } from "@/components/shared/modals/create-task-presentation";
import { cn } from "@/lib/cn";

export type PickerPopoverOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

/** Pickers with more options than this switch to a searchable Command list. */
export const PICKER_SEARCH_THRESHOLD = 8;

const PickerSearchListImpl = lazy(() => import("./picker-search-list"));

/**
 * Searchable option list (Kaneo's Command pattern, as in the relations picker) shown inside a
 * Popover. The Command implementation loads on first open so it stays out of the initial route
 * graph. Selection state and closing are the caller's.
 */
export function PickerSearchList(props: {
  options: readonly PickerPopoverOption[];
  isSelected: (value: string) => boolean;
  onSelect: (value: string) => void;
  searchLabel?: string;
}) {
  return (
    <Suspense fallback={<div className="h-24" aria-busy="true" />}>
      <PickerSearchListImpl {...props} />
    </Suspense>
  );
}

/**
 * Kaneo's property-picker pattern (task priority/status/assignee popovers): a ghost trigger
 * button that opens a Popover holding a list of ghost option buttons with a check on the chosen
 * one. Use it for filters and inline pickers; keep `Select` for fields inside settings forms.
 * `value` is the option value (or `undefined` to show `placeholder`). With more than
 * `PICKER_SEARCH_THRESHOLD` options the list becomes searchable.
 */
export function PickerPopover({
  id,
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  disabled,
  className,
  contentClassName,
  testId,
}: {
  id?: string;
  value: string | undefined;
  options: readonly PickerPopoverOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const searchable = options.length > PICKER_SEARCH_THRESHOLD;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          aria-label={ariaLabel}
          disabled={disabled}
          data-testid={testId}
          className={cn("min-w-0 justify-between gap-2 font-normal", className)}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          searchable ? "w-64 p-0" : "w-56 max-h-72 overflow-y-auto p-1",
          contentClassName,
        )}
        align="start"
      >
        {searchable ? (
          <PickerSearchList
            options={options}
            isSelected={(candidate) => candidate === value}
            onSelect={(next) => {
              onChange(next);
              setOpen(false);
            }}
          />
        ) : (
          <div className="space-y-1">
            {options.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                className={CREATE_TASK_PROPERTY_OPTION_CLASS}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="truncate text-sm">{option.label}</span>
                {option.value === value ? (
                  <Check className="ml-auto h-4 w-4 shrink-0" />
                ) : null}
              </Button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
