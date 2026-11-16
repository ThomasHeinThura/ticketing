import { Label } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import {
  type CustomFieldPerson,
  CustomFieldValueInput,
} from "@/components/custom-field/custom-field-value-input";
import type { CustomField } from "@/fetchers/custom-field";

export type CreateFormCustomField = CustomField & { required: boolean };

/**
 * Render the caller-selected CF-3/CF-6 fields, including fields the server reveals for
 * template validation recovery. Required fields are marked; the API validates template defaults.
 */
export default function CreateWorkItemCustomFields({
  fields,
  values,
  people,
  disabled,
  onChange,
}: {
  fields: readonly CreateFormCustomField[];
  values: Record<string, unknown>;
  people: readonly CustomFieldPerson[];
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  if (fields.length === 0) return null;
  return (
    <div
      className="grid gap-3 sm:grid-cols-2"
      data-testid="create-work-item-custom-fields"
    >
      {fields.map((field) => {
        const id = `create-work-item-cf-${field.key}`;
        return (
          <div key={field.id} className="flex flex-col gap-1">
            <Label htmlFor={id} className="text-muted-foreground text-xs">
              {field.name}
              {field.required ? (
                <span aria-hidden="true" className="text-destructive">
                  {" *"}
                </span>
              ) : (
                <span className="font-normal">
                  {` (${t("workItems:customFieldValue.optional")})`}
                </span>
              )}
            </Label>
            <CustomFieldValueInput
              id={id}
              field={field}
              value={values[field.key] ?? null}
              people={people}
              disabled={disabled}
              onChange={(value) => onChange(field.key, value)}
            />
            {field.helpText ? (
              <p className="text-muted-foreground text-xs">{field.helpText}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
