import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";

export type PickerOption = { value: string; label: string };

/**
 * One labelled-option select, so every picker in the rule editor shows the chosen option's label
 * (an id is never shown) and follows the same Kaneo `Select` pattern as the work item templates
 * editor.
 */
export function PickerSelect({
  id,
  value,
  options,
  placeholder,
  disabled,
  ariaLabel,
  onChange,
}: {
  id?: string;
  value: string;
  options: readonly PickerOption[];
  placeholder: string;
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next ?? "")}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className="min-w-0">
        <SelectValue placeholder={placeholder}>{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
