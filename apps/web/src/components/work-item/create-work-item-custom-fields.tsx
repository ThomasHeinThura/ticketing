import { Label } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import {
  type CustomFieldPerson,
  CustomFieldValueInput,
} from "@/components/custom-field/custom-field-value-input";
import type { CustomField } from "@/fetchers/custom-field";
import { conditionSatisfied } from "@/lib/custom-field";

export type CreateFormCustomField = CustomField & { required: boolean };

/**
 * CF-3/CF-5/CF-6 on creation: the fields that apply to the chosen type, as plain labelled
 * controls under the property row. A conditional field appears only while its condition holds;
 * required fields are marked and block the create button until filled.
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
  const shown = fields.filter((field) =>
    conditionSatisfied(field.visibilityCondition, values),
  );
  if (shown.length === 0) return null;
  return (
    <div
      className="grid gap-3 sm:grid-cols-2"
      data-testid="create-work-item-custom-fields"
    >
      {shown.map((field) => {
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
                  {` (${t("customFields:value.optional")})`}
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
