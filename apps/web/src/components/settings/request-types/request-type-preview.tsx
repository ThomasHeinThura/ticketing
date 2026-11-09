import type { FormSchema } from "@taskdesk/domain";
import {
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveIntakeVisibility } from "@/lib/intake-visibility";
import type { RequestTypeField } from "./request-type-model";

/** How the customer sees the draft form, honouring `showIf` rules as values are typed. */
export function RequestTypePreview({
  description,
  fields,
}: {
  description: string | null;
  fields: RequestTypeField[];
}) {
  const { t } = useTranslation("requestTypes");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const visibility = resolveIntakeVisibility(
    { fields } as unknown as FormSchema,
    values,
  );
  const set = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <section className="rounded-md bg-muted p-4">
      <h3 className="font-medium">
        {t("preview", { defaultValue: "Customer preview" })}
      </h3>
      <p className="text-sm text-muted-foreground">
        {description ||
          t("previewDescription", {
            defaultValue: "Request form description",
          })}
      </p>
      <div className="mt-3 grid gap-3">
        {fields
          .filter((field) => visibility.get(field.key) ?? true)
          .map((field) => (
            <div key={field.key} className="flex flex-col gap-1 text-sm">
              {field.label}
              {field.required ? " *" : ""}
              {field.type === "textarea" ? (
                <Textarea
                  aria-label={field.label}
                  placeholder={field.help}
                  value={String(values[field.key] ?? "")}
                  onChange={(event) => set(field.key, event.target.value)}
                />
              ) : field.type === "select" ? (
                <Select
                  value={String(values[field.key] ?? "") || null}
                  onValueChange={(value) => set(field.key, value ?? "")}
                >
                  <SelectTrigger aria-label={field.label}>
                    <SelectValue
                      placeholder={t("choose", { defaultValue: "Choose…" })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options?.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.type === "file" ? (
                <Input
                  type="file"
                  aria-label={field.label}
                  multiple={field.multiple}
                />
              ) : field.type === "checkbox" ? (
                <Checkbox
                  aria-label={field.label}
                  checked={Boolean(values[field.key])}
                  onCheckedChange={(checked) =>
                    set(field.key, Boolean(checked))
                  }
                />
              ) : (
                <Input
                  type="text"
                  aria-label={field.label}
                  value={String(values[field.key] ?? "")}
                  onChange={(event) => set(field.key, event.target.value)}
                />
              )}
            </div>
          ))}
      </div>
    </section>
  );
}
