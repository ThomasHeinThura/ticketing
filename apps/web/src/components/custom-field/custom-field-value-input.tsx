import {
  Button,
  Calendar,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@taskdesk/ui";
import { CalendarDays, Check, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type CustomFieldFormat,
  type CustomFieldOption,
  formatValue,
  isValueSet,
} from "@/lib/custom-field";
import { dayToIso, isoToDay } from "@/lib/work-item-date";

export type CustomFieldPerson = { personId: string; name: string | null };

export type CustomFieldValueInputProps = {
  id: string;
  field: {
    name: string;
    format: CustomFieldFormat;
    options: CustomFieldOption[];
  };
  value: unknown;
  /** Called with the new value (`null` clears). Text-like formats call it as the user types. */
  onChange: (value: unknown) => void;
  /** Text-like formats: the control lost focus (a row saves here). */
  onBlur?: () => void;
  disabled?: boolean;
  people?: readonly CustomFieldPerson[];
};

function ListChoice({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2"
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="truncate text-xs">{label}</span>
      {selected ? <Check className="ml-auto size-3" /> : null}
    </Button>
  );
}

/** A popover list of choices for `multi_select` / `multi_user`; selection toggles. */
function MultiChoice({
  id,
  choices,
  selected,
  disabled,
  summary,
  onChange,
}: {
  id: string;
  choices: { key: string; label: string }[];
  selected: string[];
  disabled?: boolean;
  summary: string;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          size="sm"
          className="w-full justify-start font-normal"
          disabled={disabled}
        >
          <span className="truncate">
            {summary || t("customFields:value.notSet")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="flex max-h-60 flex-col overflow-y-auto">
          {choices.length === 0 ? (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">
              {t("customFields:value.noChoices")}
            </p>
          ) : (
            choices.map((choice) => (
              <ListChoice
                key={choice.key}
                label={choice.label}
                selected={selected.includes(choice.key)}
                onSelect={() =>
                  onChange(
                    selected.includes(choice.key)
                      ? selected.filter((key) => key !== choice.key)
                      : [...selected, choice.key],
                  )
                }
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One control per custom field format (CF formats), built from `@taskdesk/ui`. Used by the
 * work item properties panel and the create form so a field edits the same way in both.
 */
export function CustomFieldValueInput({
  id,
  field,
  value,
  onChange,
  onBlur,
  disabled,
  people = [],
}: CustomFieldValueInputProps) {
  const { t } = useTranslation();
  const [dateOpen, setDateOpen] = useState(false);
  const peopleNames = new Map(
    people.map((person) => [person.personId, person.name ?? ""]),
  );

  switch (field.format) {
    case "text":
    case "email":
    case "url":
      return (
        <Input
          id={id}
          type={field.format === "text" ? "text" : field.format}
          maxLength={field.format === "text" ? 500 : 2000}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      );
    case "long_text":
      return (
        <Textarea
          id={id}
          rows={3}
          maxLength={20000}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      );
    case "number":
    case "decimal":
      return (
        <Input
          id={id}
          type="number"
          step={field.format === "number" ? 1 : "any"}
          value={typeof value === "number" ? String(value) : ""}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.target.value === "" ? null : Number(event.target.value),
            )
          }
          onBlur={onBlur}
        />
      );
    case "currency": {
      const current = (value ?? {}) as { amount?: number; currency?: string };
      const update = (next: { amount?: number | null; currency?: string }) => {
        const amount = next.amount === undefined ? current.amount : next.amount;
        const currency = next.currency ?? current.currency ?? "";
        onChange(
          amount === null || amount === undefined
            ? null
            : { amount, currency: currency.toUpperCase() },
        );
      };
      return (
        <div className="flex gap-2">
          <Input
            id={id}
            type="number"
            step="any"
            aria-label={t("customFields:value.amount")}
            value={typeof current.amount === "number" ? current.amount : ""}
            disabled={disabled}
            onChange={(event) =>
              update({
                amount:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
            onBlur={onBlur}
          />
          <Input
            type="text"
            maxLength={3}
            className="w-24"
            aria-label={t("customFields:value.currencyCode")}
            placeholder="USD"
            value={current.currency ?? ""}
            disabled={disabled}
            onChange={(event) => update({ currency: event.target.value })}
            onBlur={onBlur}
          />
        </div>
      );
    }
    case "date": {
      const day = typeof value === "string" ? isoToDay(value) : undefined;
      return (
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              variant="outline"
              size="sm"
              className="w-full justify-start font-normal"
              disabled={disabled}
            >
              <CalendarDays className="size-4 text-muted-foreground" />
              <span className="truncate">
                {isValueSet(value)
                  ? formatValue({ ...field, format: "date" }, value)
                  : t("customFields:value.notSet")}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0" align="start">
            <Calendar
              mode="single"
              selected={day}
              onSelect={(selected) => {
                onChange(
                  selected
                    ? (dayToIso(selected, null) ?? "").slice(0, 10)
                    : null,
                );
                setDateOpen(false);
              }}
              className="w-full bg-popover"
            />
            {isValueSet(value) ? (
              <div className="border-border border-t pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    onChange(null);
                    setDateOpen(false);
                  }}
                >
                  <X className="h-4 w-4" />
                  {t("customFields:value.clear")}
                </Button>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      );
    }
    case "datetime": {
      const local =
        typeof value === "string" && !Number.isNaN(Date.parse(value))
          ? new Date(
              new Date(value).getTime() -
                new Date(value).getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16)
          : "";
      return (
        <Input
          id={id}
          type="datetime-local"
          value={local}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.target.value
                ? new Date(event.target.value).toISOString()
                : null,
            )
          }
          onBlur={onBlur}
        />
      );
    }
    case "boolean":
      return (
        <Switch
          id={id}
          checked={value === true}
          disabled={disabled}
          aria-label={field.name}
          onCheckedChange={(checked) => onChange(checked)}
        />
      );
    case "select":
      return (
        <Select
          value={typeof value === "string" ? value : null}
          disabled={disabled}
          onValueChange={(next) => onChange(next ?? null)}
        >
          <SelectTrigger id={id}>
            <SelectValue>
              {typeof value === "string"
                ? formatValue(field, value)
                : t("customFields:value.notSet")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "multi_select":
      return (
        <MultiChoice
          id={id}
          choices={field.options}
          selected={Array.isArray(value) ? (value as string[]) : []}
          disabled={disabled}
          summary={formatValue(field, value)}
          onChange={(next) => onChange(next.length ? next : null)}
        />
      );
    case "user":
      return (
        <Select
          value={typeof value === "string" ? value : null}
          disabled={disabled}
          onValueChange={(next) => onChange(next ?? null)}
        >
          <SelectTrigger id={id}>
            <SelectValue>
              {typeof value === "string"
                ? (peopleNames.get(value) ??
                  t("customFields:value.notOnProject"))
                : t("customFields:value.notSet")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {people.map((person) => (
              <SelectItem key={person.personId} value={person.personId}>
                {person.name ?? person.personId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "multi_user":
      return (
        <MultiChoice
          id={id}
          choices={people.map((person) => ({
            key: person.personId,
            label: person.name ?? person.personId,
          }))}
          selected={Array.isArray(value) ? (value as string[]) : []}
          disabled={disabled}
          summary={formatValue(field, value, peopleNames)}
          onChange={(next) => onChange(next.length ? next : null)}
        />
      );
    default:
      return null;
  }
}
