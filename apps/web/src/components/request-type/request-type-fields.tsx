import {
  type FormSchema,
  type FormValue,
  visibleFields,
} from "@taskdesk/domain/intake";
import {
  Checkbox,
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@taskdesk/ui";
import { type ReactNode, useId } from "react";

type Props = {
  schema: FormSchema;
  values: Readonly<Record<string, FormValue>>;
  errors?: Readonly<Record<string, string>>;
  requiredLabel: string;
  selectPlaceholder: string;
  emptyOptionsLabel: string;
  comboTriggerLabel: string;
  onValueChange: (key: string, value: FormValue) => void;
  onFilesChange?: (key: string, files: FileList | null) => void;
};

export function RequestTypeFields({
  schema,
  values,
  errors = {},
  requiredLabel,
  selectPlaceholder,
  emptyOptionsLabel,
  comboTriggerLabel,
  onValueChange,
  onFilesChange,
}: Props) {
  const idPrefix = useId();
  const fields = visibleFields(schema, values);

  return (
    <div className="space-y-5">
      {fields.map((field, index) => {
        const id = `${idPrefix}-${index}`;
        const error = errors[field.key];
        const value = values[field.key];
        const describedBy =
          [field.help ? `${id}-help` : null, error ? `${id}-error` : null]
            .filter((value): value is string => value !== null)
            .join(" ") || undefined;
        const label = (
          <Label htmlFor={id}>
            {field.label}
            {field.required ? (
              <span className="text-muted-foreground"> ({requiredLabel})</span>
            ) : null}
          </Label>
        );

        let control: ReactNode = null;
        switch (field.type) {
          case "textarea":
            control = (
              <Textarea
                id={id}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                value={typeof value === "string" ? value : ""}
                onChange={(event) =>
                  onValueChange(field.key, event.currentTarget.value)
                }
              />
            );
            break;
          case "select":
          case "combobox":
            control = field.multiple ? (
              <div className="space-y-2" aria-describedby={describedBy}>
                {(field.options ?? []).map((option, optionIndex) => {
                  const selected = Array.isArray(value)
                    ? value.includes(option)
                    : false;
                  const optionId = `${id}-${optionIndex}`;
                  return (
                    <div className="flex items-center gap-2" key={option}>
                      <Checkbox
                        id={optionId}
                        checked={selected}
                        onCheckedChange={(checked) => {
                          const current = Array.isArray(value)
                            ? value.filter(
                                (item): item is string =>
                                  typeof item === "string",
                              )
                            : [];
                          onValueChange(
                            field.key,
                            checked
                              ? [...current, option]
                              : current.filter((item) => item !== option),
                          );
                        }}
                      />
                      <Label htmlFor={optionId}>{option}</Label>
                    </div>
                  );
                })}
              </div>
            ) : field.type === "combobox" ||
              (field.options?.length ?? 0) > 10 ? (
              <Combobox
                items={field.options ?? []}
                value={typeof value === "string" ? value : null}
                onValueChange={(next) => {
                  if (typeof next === "string") {
                    onValueChange(field.key, next);
                  }
                }}
              >
                <ComboboxInput
                  id={id}
                  aria-label={field.label}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                  placeholder={selectPlaceholder}
                  triggerLabel={comboTriggerLabel}
                />
                <ComboboxPopup>
                  <ComboboxList>
                    {(option: string) => (
                      <ComboboxItem key={option} value={option}>
                        {option}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                  <ComboboxEmpty>{emptyOptionsLabel}</ComboboxEmpty>
                </ComboboxPopup>
              </Combobox>
            ) : (
              <Select
                value={typeof value === "string" ? value : ""}
                onValueChange={(next) => onValueChange(field.key, next)}
              >
                <SelectTrigger
                  id={id}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                >
                  <SelectValue placeholder={selectPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
            break;
          case "checkbox":
            control = (
              <Checkbox
                id={id}
                checked={value === true}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                onCheckedChange={(checked) =>
                  onValueChange(field.key, checked === true)
                }
              />
            );
            break;
          case "file":
            control = (
              <Input
                id={id}
                type="file"
                multiple={field.multiple}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                onChange={(event) =>
                  onFilesChange?.(field.key, event.currentTarget.files)
                }
              />
            );
            break;
          case "number":
            control = (
              <Input
                id={id}
                type="number"
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                value={typeof value === "number" ? value : ""}
                onChange={(event) => {
                  const raw = event.currentTarget.value;
                  onValueChange(field.key, raw === "" ? null : Number(raw));
                }}
              />
            );
            break;
          case "date":
            control = (
              <Input
                id={id}
                type="date"
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                value={typeof value === "string" ? value : ""}
                onChange={(event) =>
                  onValueChange(field.key, event.currentTarget.value)
                }
              />
            );
            break;
          case "text":
            control = (
              <Input
                id={id}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                value={typeof value === "string" ? value : ""}
                onChange={(event) =>
                  onValueChange(field.key, event.currentTarget.value)
                }
              />
            );
            break;
        }

        return (
          <div className="space-y-2" key={field.key}>
            {field.type === "checkbox" ? (
              <div className="flex items-center gap-2">
                {control}
                {label}
              </div>
            ) : (
              <>
                {label}
                {control}
              </>
            )}
            {field.help ? (
              <p id={`${id}-help`} className="text-sm text-muted-foreground">
                {field.help}
              </p>
            ) : null}
            {error ? (
              <p id={`${id}-error`} className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
