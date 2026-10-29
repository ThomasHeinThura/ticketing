import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Label,
} from "@taskdesk/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CustomFieldValueInput } from "@/components/custom-field/custom-field-value-input";
import useGetAssignablePeople from "@/hooks/queries/work-item/use-get-assignable-people";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { conditionSatisfied, isValueSet } from "@/lib/custom-field";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import {
  isWorkItemAccessLost,
  WorkItemVersionConflictError,
} from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import { useWorkItemFeedback } from "./work-item-feedback";
import { useRefreshWorkItem, useSaveWorkItemFields } from "./work-item-save";

type DetailField = WorkItemDetailRow["customFields"][number];

/** Formats that commit as soon as they change; the rest commit when the control loses focus. */
const COMMIT_ON_CHANGE = new Set([
  "boolean",
  "select",
  "multi_select",
  "user",
  "multi_user",
  "date",
  // The datetime popover emits only a complete Save/Clear, never intermediate drafts.
  "datetime",
]);

function FieldRow({
  item,
  field,
  values,
  canEdit,
  people,
  onAccessLost,
  onDraft,
}: {
  item: WorkItemDetailRow;
  field: DetailField;
  values: Record<string, unknown>;
  canEdit: boolean;
  people: { personId: string; name: string | null }[];
  onAccessLost: () => void;
  onDraft: (key: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const { announce, clearConflict, reportConflict } = useWorkItemFeedback();
  const refresh = useRefreshWorkItem(item);
  const [error, setError] = useState("");
  const serverValue = field.value ?? null;
  const [draft, setDraft] = useState<unknown>(serverValue);
  const serverSignature = JSON.stringify(serverValue);
  // A refetch (after a save or a conflict) puts the server's value back in the control.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialised server value
  useEffect(() => {
    setDraft(serverValue);
  }, [serverSignature]);

  const save = useSaveWorkItemFields(item, {
    onSuccess: () => {
      setError("");
      clearConflict();
      announce(t("workItems:journey.editSaved"));
    },
    onError: (cause) => {
      if (isWorkItemAccessLost(cause)) {
        onAccessLost();
        return;
      }
      if (cause instanceof WorkItemVersionConflictError) {
        reportConflict();
        void refresh();
        return;
      }
      if (cause instanceof HttpError && cause.status === 400) {
        setError(cause.message);
        return;
      }
      toast.error(t("workItems:properties.saveFailed"));
      void refresh();
    },
  });

  const commit = (value: unknown) => {
    if (!canEdit || save.isPending) return;
    if (JSON.stringify(value ?? null) === serverSignature) return;
    save.mutate({ customFields: { [field.key]: value ?? null } });
  };
  const inputId = `work-item-cf-${field.key}`;
  return (
    <div
      className="flex flex-col gap-1 px-2"
      data-testid={`work-item-custom-field-${field.key}`}
    >
      <Label
        htmlFor={inputId}
        className="font-normal text-muted-foreground text-xs"
      >
        {field.name}
        {field.required ? (
          <span aria-hidden="true" className="text-destructive">
            {" *"}
          </span>
        ) : null}
      </Label>
      {canEdit ? (
        <CustomFieldValueInput
          id={inputId}
          inline
          field={field}
          value={draft}
          people={people}
          disabled={save.isPending}
          onChange={(value) => {
            setDraft(value);
            onDraft(field.key, value);
            if (COMMIT_ON_CHANGE.has(field.format)) commit(value);
          }}
          onBlur={() => {
            if (!COMMIT_ON_CHANGE.has(field.format)) commit(draft);
          }}
        />
      ) : (
        <p className="font-semibold text-xs">
          {isValueSet(serverValue) ? (
            <ReadOnlyValue field={field} people={people} />
          ) : (
            <span className="font-normal text-muted-foreground">
              {t("customFields:value.notSet")}
            </span>
          )}
        </p>
      )}
      {field.helpText ? (
        <p className="text-muted-foreground text-xs">{field.helpText}</p>
      ) : null}
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      {field.required && !isValueSet(values[field.key]) ? (
        <p className="text-muted-foreground text-xs">
          {t("customFields:value.requiredHint")}
        </p>
      ) : null}
    </div>
  );
}

function ReadOnlyValue({
  field,
  people,
}: {
  field: DetailField;
  people: { personId: string; name: string | null }[];
}) {
  const { t } = useTranslation();
  const names = new Map(people.map((p) => [p.personId, p.name ?? ""]));
  const label = (key: unknown) =>
    field.options.find((o) => o.key === key)?.label ?? String(key);
  const value = field.value;
  switch (field.format) {
    case "select":
      return <>{label(value)}</>;
    case "multi_select":
      return <>{(value as string[]).map(label).join(", ")}</>;
    case "user":
      return (
        <>{names.get(String(value)) || t("customFields:value.notOnProject")}</>
      );
    case "multi_user":
      return (
        <>
          {(value as string[])
            .map((id) => names.get(id) || t("customFields:value.notOnProject"))
            .join(", ")}
        </>
      );
    case "boolean":
      return (
        <>
          {value === true
            ? t("customFields:value.yes")
            : t("customFields:value.no")}
        </>
      );
    case "currency": {
      const money = value as { amount: number; currency: string };
      return <>{`${money.amount.toLocaleString()} ${money.currency}`}</>;
    }
    case "datetime":
      return <>{new Date(String(value)).toLocaleString()}</>;
    case "url":
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 hover:underline"
        >
          {String(value)}
        </a>
      );
    default:
      return <>{String(value)}</>;
  }
}

/**
 * CF-3 / CF-6: the custom fields that apply to this work item's type, grouped into collapsible
 * sections under the property rows. Fields that do not apply are absent; a conditional field
 * appears only while its condition holds. Values save with the item's version, like every
 * other property.
 */
export default function WorkItemCustomFields(props: {
  item: WorkItemDetailRow;
  onAccessLost: () => void;
  readOnly?: boolean;
}) {
  // No applicable fields: render nothing and mount no hooks (most types have none).
  if ((props.item.customFields ?? []).length === 0) return null;
  return <WorkItemCustomFieldSections {...props} />;
}

function WorkItemCustomFieldSections({
  item,
  onAccessLost,
  readOnly = false,
}: {
  item: WorkItemDetailRow;
  onAccessLost: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { canUpdateTasks } = useWorkspacePermission(
    item.workspaceId,
    item.projectId,
  );
  const canEdit = !readOnly && canUpdateTasks();
  const fields = item.customFields ?? [];
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const needsPeople = fields.some(
    (field) => field.format === "user" || field.format === "multi_user",
  );
  const people = useGetAssignablePeople({
    projectId: item.projectId,
    enabled: needsPeople,
  });

  const values: Record<string, unknown> = {
    ...Object.fromEntries(fields.map((field) => [field.key, field.value])),
    ...overrides,
  };
  const visible = fields.filter((field) =>
    conditionSatisfied(field.visibilityCondition, values),
  );
  const sections = [...new Set(visible.map((field) => field.sectionId))].map(
    (sectionId) => ({
      id: sectionId,
      name: visible.find((field) => field.sectionId === sectionId)?.sectionName,
      fields: visible.filter((field) => field.sectionId === sectionId),
    }),
  );
  return (
    <div
      className="flex flex-col gap-1 px-3 py-1"
      data-testid="work-item-custom-fields"
    >
      {sections.map((section) => (
        <Collapsible
          key={section.id}
          open={!collapsed.has(section.id)}
          onOpenChange={(open) =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (open) next.delete(section.id);
              else next.add(section.id);
              return next;
            })
          }
        >
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start gap-1.5 px-1 text-xs font-medium text-foreground"
              />
            }
          >
            {collapsed.has(section.id) ? (
              <ChevronRight className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
            {section.name || t("customFields:fallbackSection")}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-3 py-2">
              {section.fields.map((field) => (
                <FieldRow
                  key={field.id}
                  item={item}
                  field={field}
                  values={values}
                  canEdit={canEdit}
                  people={people.data ?? []}
                  onAccessLost={onAccessLost}
                  onDraft={(key, value) =>
                    setOverrides((current) => ({ ...current, [key]: value }))
                  }
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
