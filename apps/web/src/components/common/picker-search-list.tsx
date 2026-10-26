import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@taskdesk/ui";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PickerPopoverOption } from "@/components/common/picker-popover";

/**
 * Searchable option list (Kaneo's Command pattern, as in the relations picker) shown inside a
 * Popover. Selection state and closing are the caller's: `isSelected` draws the check mark and
 * `onSelect` fires on pointer or keyboard selection.
 */
export default function PickerSearchListImpl({
  options,
  isSelected,
  onSelect,
  searchLabel,
}: {
  options: readonly PickerPopoverOption[];
  isSelected: (value: string) => boolean;
  onSelect: (value: string) => void;
  searchLabel?: string;
}) {
  const { t } = useTranslation();
  const label = searchLabel ?? t("common:picker.search");
  return (
    <Command
      items={options}
      filter={(item: unknown, query: string) =>
        (item as PickerPopoverOption).label
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      }
    >
      <CommandInput aria-label={label} placeholder={label} maxLength={200} />
      <CommandEmpty>{t("common:picker.noResults")}</CommandEmpty>
      <CommandList className="max-h-60 overflow-y-auto">
        {(option: PickerPopoverOption) => (
          <CommandItem
            key={option.value}
            value={option.label}
            disabled={option.disabled}
            onClick={() => onSelect(option.value)}
            className="flex items-center gap-2"
          >
            <span className="truncate text-sm">{option.label}</span>
            {isSelected(option.value) ? (
              <Check className="ml-auto h-4 w-4 shrink-0" />
            ) : null}
          </CommandItem>
        )}
      </CommandList>
    </Command>
  );
}
