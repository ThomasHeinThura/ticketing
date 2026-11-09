import {
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@taskdesk/ui";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PRIORITY_VALUES,
  priorityValueFor,
  type RequestTypeField,
} from "./request-type-model";

const FIELD_TYPES: RequestTypeField["type"][] = [
  "text",
  "textarea",
  "select",
  "checkbox",
  "file",
];

/** One form-field row in the request type editor. Drag-and-drop and up/down reorder rows. */
export function RequestTypeFieldRow({
  field,
  index,
  fields,
  optionsText,
  collectableFields,
  onChange,
  onOptionsText,
  onOptionsBlur,
  onMove,
  onRemove,
  onDragStart,
  onDrop,
}: {
  field: RequestTypeField;
  index: number;
  fields: RequestTypeField[];
  optionsText: string | undefined;
  collectableFields: Array<{ id: string; key: string; name: string }>;
  onChange: (patch: Partial<RequestTypeField>) => void;
  onOptionsText: (raw: string) => void;
  onOptionsBlur: () => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const { t } = useTranslation("requestTypes");
  const typeLabel: Record<RequestTypeField["type"], string> = {
    text: t("text", { defaultValue: "Text" }),
    textarea: t("longText", { defaultValue: "Long text" }),
    select: t("select", { defaultValue: "Select" }),
    checkbox: t("checkbox", { defaultValue: "Checkbox" }),
    file: t("file", { defaultValue: "File" }),
  };
  const mapsToLabel: Record<string, string> = {
    title: t("titleMapping", { defaultValue: "Work item title" }),
    description: t("descriptionMapping", {
      defaultValue: "Work item description",
    }),
    priority: t("priorityMapping", { defaultValue: "Work item priority" }),
  };
  const priorityLabel: Record<string, string> = {
    low: t("workItems:priority.low", { defaultValue: "Low" }),
    medium: t("workItems:priority.medium", { defaultValue: "Medium" }),
    high: t("workItems:priority.high", { defaultValue: "High" }),
    urgent: t("workItems:priority.urgent", { defaultValue: "Urgent" }),
  };
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      <label
        className="flex flex-col gap-1 text-sm"
        htmlFor={`field-key-${index}`}
      >
        {t("fieldKey", { defaultValue: "Field key" })}
        <Input
          id={`field-key-${index}`}
          value={field.key}
          onChange={(e) => onChange({ key: e.target.value })}
        />
      </label>
      <label
        className="flex flex-col gap-1 text-sm"
        htmlFor={`field-label-${index}`}
      >
        {t("label", { defaultValue: "Customer label" })}
        <Input
          id={`field-label-${index}`}
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </label>
      <label
        className="flex flex-col gap-1 text-sm"
        htmlFor={`field-type-${index}`}
      >
        {t("type", { defaultValue: "Type" })}
        <Select
          value={field.type}
          onValueChange={(value) =>
            value && onChange({ type: value as RequestTypeField["type"] })
          }
        >
          <SelectTrigger id={`field-type-${index}`}>
            <SelectValue>{typeLabel[field.type]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {typeLabel[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label
        className="flex items-center gap-2 self-end text-sm sm:min-h-9"
        htmlFor={`field-required-${index}`}
      >
        <Checkbox
          id={`field-required-${index}`}
          checked={field.required}
          disabled={field.type === "file" && !field.required}
          onCheckedChange={(checked) =>
            onChange({ required: Boolean(checked) })
          }
        />
        {t("required", { defaultValue: "Required" })}
      </label>
      {field.type === "file" && (
        <p
          className={
            field.required
              ? "text-sm text-destructive sm:col-span-2"
              : "text-sm text-muted-foreground sm:col-span-2"
          }
        >
          {field.required
            ? t("fileRequiredBlocked", {
                defaultValue:
                  "Required file uploads are not publishable until the submission file contract is defined; clear Required to publish.",
              })
            : t("fileRequiredUnavailable", {
                defaultValue:
                  "Required is unavailable for file uploads until the submission file contract is defined.",
              })}
        </p>
      )}
      <label
        className="flex flex-col gap-1 text-sm sm:col-span-2"
        htmlFor={`field-help-${index}`}
      >
        {t("help", { defaultValue: "Help text" })}
        <Input
          id={`field-help-${index}`}
          value={field.help ?? ""}
          onChange={(e) => onChange({ help: e.target.value || undefined })}
        />
      </label>
      <label
        className="flex flex-col gap-1 text-sm sm:col-span-2"
        htmlFor={`field-options-${index}`}
      >
        {t("options", { defaultValue: "Options (one per line)" })}
        <Textarea
          id={`field-options-${index}`}
          value={optionsText ?? (field.options ?? []).join("\n")}
          onChange={(e) => onOptionsText(e.target.value)}
          onBlur={onOptionsBlur}
          disabled={field.type !== "select"}
        />
      </label>
      <label
        className="flex flex-col gap-1 text-sm"
        htmlFor={`field-maps-to-${index}`}
      >
        {t("mapsTo", { defaultValue: "Maps to" })}
        <Select
          value={field.mapsTo?.field ?? null}
          onValueChange={(value) =>
            onChange({ mapsTo: value ? { field: value } : undefined })
          }
        >
          <SelectTrigger id={`field-maps-to-${index}`}>
            <SelectValue
              placeholder={t("unmapped", {
                defaultValue: "Keep in request data",
              })}
            >
              {field.mapsTo?.field
                ? (mapsToLabel[field.mapsTo.field] ??
                  collectableFields.find(
                    (candidate) =>
                      `cf.${candidate.key}` === field.mapsTo?.field,
                  )?.name ??
                  field.mapsTo.field)
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="title">{mapsToLabel.title}</SelectItem>
            <SelectItem value="description">
              {mapsToLabel.description}
            </SelectItem>
            <SelectItem value="priority">{mapsToLabel.priority}</SelectItem>
            {collectableFields.map((candidate) => (
              <SelectItem key={candidate.id} value={`cf.${candidate.key}`}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label
        className="flex flex-col gap-1 text-sm"
        htmlFor={`field-show-when-${index}`}
      >
        {t("showWhen", { defaultValue: "Show when" })}
        <Select
          value={field.showIf?.field_key ?? null}
          onValueChange={(value) =>
            onChange({
              showIf: value
                ? { field_key: value, op: "eq", value: "" }
                : undefined,
            })
          }
        >
          <SelectTrigger id={`field-show-when-${index}`}>
            <SelectValue
              placeholder={t("always", { defaultValue: "Always visible" })}
            >
              {field.showIf
                ? fields.find(
                    (candidate) => candidate.key === field.showIf?.field_key,
                  )?.label
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {fields
              .filter((candidate) => candidate.key !== field.key)
              .map((candidate) => (
                <SelectItem key={candidate.key} value={candidate.key}>
                  {candidate.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </label>
      {field.type === "select" && field.mapsTo?.field === "priority" && (
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="text-sm font-medium">
            {t("priorityMappingLegend", {
              defaultValue: "Priority value mapping",
            })}
          </legend>
          {field.options?.map((option) => (
            <label
              key={option}
              className="grid gap-2 text-sm sm:grid-cols-2"
              htmlFor={`field-map-${index}-${option}`}
            >
              <span>{option}</span>
              <Select
                value={priorityValueFor(field, option)}
                onValueChange={(value) => {
                  const map = { ...(field.mapsTo?.map ?? {}) };
                  if (value) map[option] = value;
                  else delete map[option];
                  onChange({ mapsTo: { field: "priority", map } });
                }}
              >
                <SelectTrigger id={`field-map-${index}-${option}`}>
                  <SelectValue
                    placeholder={t("choosePriority", {
                      defaultValue: "Choose priority",
                    })}
                  >
                    {priorityLabel[priorityValueFor(field, option) ?? ""] ??
                      undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {priorityLabel[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
        </fieldset>
      )}
      {field.showIf && (
        <label
          className="flex flex-col gap-1 text-sm"
          htmlFor={`field-show-value-${index}`}
        >
          {t("equals", { defaultValue: "Equals value" })}
          <Input
            id={`field-show-value-${index}`}
            value={String(field.showIf.value ?? "")}
            onChange={(e) =>
              onChange({
                showIf: {
                  ...(field.showIf ?? { field_key: "", op: "eq" }),
                  value: e.target.value,
                },
              })
            }
          />
        </label>
      )}
      {field.type === "file" && (
        <label
          className="flex items-center gap-2 text-sm"
          htmlFor={`field-multiple-${index}`}
        >
          <Checkbox
            id={`field-multiple-${index}`}
            checked={field.multiple ?? false}
            onCheckedChange={(checked) =>
              onChange({ multiple: Boolean(checked) })
            }
          />
          {t("multiple", { defaultValue: "Allow multiple files" })}
        </label>
      )}
      <div className="flex justify-end gap-1 sm:col-span-2">
        <Button
          aria-label={t("moveUp", {
            name: field.label,
            defaultValue: "Move {{name}} up",
          })}
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ArrowUp aria-hidden="true" className="size-4" />
        </Button>
        <Button
          aria-label={t("moveDown", {
            name: field.label,
            defaultValue: "Move {{name}} down",
          })}
          disabled={index === fields.length - 1}
          onClick={() => onMove(index + 1)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ArrowDown aria-hidden="true" className="size-4" />
        </Button>
        <Button
          aria-label={t("removeField", {
            name: field.label,
            defaultValue: "Remove {{name}}",
          })}
          onClick={onRemove}
          size="sm"
          type="button"
          variant="destructive-outline"
        >
          {t("remove", { defaultValue: "Remove" })}
        </Button>
      </div>
    </article>
  );
}
