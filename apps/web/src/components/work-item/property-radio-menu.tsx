import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@taskdesk/ui";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Kaneo's option row on the library radio item: leading icon and label first, the check at
 * the end of the row where Kaneo draws it. The library item puts its indicator in a leading
 * column, so the two direct children (the indicator, present only when checked, and the
 * content) are placed on one grid row with the content first.
 */
export const PROPERTY_MENU_ITEM_CLASS =
  "grid-cols-[minmax(0,1fr)_auto] gap-2 ps-2 pe-2 [&>[data-checked]]:col-start-2 [&>[data-checked]]:row-start-1 [&>span:last-child]:col-start-1 [&>span:last-child]:row-start-1 [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2";

export type PropertyRadioOption = {
  value: string;
  /**
   * The option's name: its accessible name and typeahead text. Set explicitly because the
   * library check indicator carries an SVG title that would otherwise join the name.
   */
  label: string;
  /** Row content: icon, label, optional hint. */
  content: ReactNode;
  disabled?: boolean;
};

/**
 * A single-choice property picker (type, priority, status, assignee): a library Menu with a
 * radio group, so options are `menuitemradio`s with roving arrow-key focus, typeahead,
 * Escape to close and focus returned to the trigger. Choosing an option closes the menu. The
 * menu is named by its trigger (give the trigger an `aria-label`).
 */
export function PropertyRadioMenu({
  trigger,
  value,
  options,
  onValueChange,
  open,
  onOpenChange,
  contentClassName,
  header,
  disabled,
}: {
  trigger: ReactElement;
  value: string;
  options: readonly PropertyRadioOption[];
  onValueChange: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  contentClassName?: string;
  /** Status or error content shown above (or instead of) the options. */
  header?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => onOpenChange?.(next)}
      modal={false}
      disabled={disabled}
    >
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        align="start"
        className={cn("w-48", contentClassName)}
      >
        {header}
        {options.length > 0 ? (
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => onValueChange(String(next))}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                label={option.label}
                aria-label={option.label}
                disabled={option.disabled}
                closeOnClick
                className={PROPERTY_MENU_ITEM_CLASS}
              >
                {option.content}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
