import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getRequestType,
  publishRequestType,
  saveRequestType,
  unpublishRequestType,
} from "@/fetchers/intake";
import { useCustomFields } from "@/hooks/queries/custom-field/use-custom-fields";
import { RequestTypeDetailsFields } from "./request-type-details-fields";
import { RequestTypeFieldRow } from "./request-type-field-row";
import {
  blankRequestType,
  draftFromRequestType,
  isPriorityMappingValid,
  isRequiredFileValid,
  isTitleMappingValid,
  type RequestType,
  type RequestTypeDraft,
  type RequestTypeField,
  type RequestTypeVersion,
} from "./request-type-model";
import { RequestTypePreview } from "./request-type-preview";

let rowCounter = 0;
const newRowId = () => `row-${++rowCounter}`;

/**
 * The create/edit Sheet. `requestTypeId` null means a new request type; the body remounts per
 * request type so a draft never leaks between them.
 */
export function RequestTypeEditorSheet({
  open,
  requestTypeId,
  workspaceId,
  types,
  onClose,
  onSaved,
}: {
  open: boolean;
  requestTypeId: string | null;
  workspaceId: string;
  types: RequestType[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation("requestTypes");
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        className="sm:max-w-2xl"
        closeLabel={t("closeEditor", { defaultValue: "Close editor" })}
      >
        {open ? (
          <RequestTypeEditorBody
            key={requestTypeId ?? "new"}
            requestTypeId={requestTypeId}
            workspaceId={workspaceId}
            types={types}
            onSaved={onSaved}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function RequestTypeEditorBody({
  requestTypeId,
  workspaceId,
  types,
  onSaved,
}: {
  requestTypeId: string | null;
  workspaceId: string;
  types: RequestType[];
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation("requestTypes");
  const queryClient = useQueryClient();
  // CF-11: a form field may be mapped to a customer-visible custom field (`cf.<key>`).
  const customFields = useCustomFields(workspaceId);
  const collectableFields = (customFields.data?.data ?? []).filter(
    (field) => field.customerVisible,
  );
  const [draft, setDraft] = useState<RequestTypeDraft>(blankRequestType());
  const [dragged, setDragged] = useState<number | null>(null);
  // Stable per-row ids (parallel to draft.formSchema.fields): the field key is
  // user-editable, so keying a row by it remounted the row on every keystroke.
  const [rowIds, setRowIds] = useState<string[]>(() => [newRowId()]);
  // Raw "Options" text while a row is being edited, so Enter and blank lines survive
  // typing; the parsed options are written on every change and the raw text is
  // dropped on blur.
  const [optionsText, setOptionsText] = useState<Record<string, string>>({});
  const detail = useQuery({
    queryKey: ["request-type", requestTypeId],
    queryFn: () => getRequestType(requestTypeId ?? ""),
    enabled: Boolean(requestTypeId),
  });
  const loaded = detail.data as unknown as
    | (RequestType & { versions?: RequestTypeVersion[] })
    | undefined;
  useEffect(() => {
    if (!loaded) return;
    setDraft(draftFromRequestType(loaded));
    setRowIds(loaded.formSchema.fields.map(() => newRowId()));
    setOptionsText({});
  }, [loaded]);
  const listed = types.find((item) => item.id === requestTypeId);
  const save = useMutation({
    mutationFn: () => {
      // A new type joins the end of its catalogue group; an edit keeps its position.
      const position = requestTypeId
        ? draft.position
        : types
            .filter((item) => item.group === draft.group.trim())
            .reduce((next, item) => Math.max(next, item.position + 1), 0);
      return saveRequestType({
        workspaceId,
        id: requestTypeId ?? undefined,
        version: loaded?.version,
        data: { ...draft, position } as unknown as Record<string, unknown>,
      });
    },
    onSuccess: async (row) => {
      const saved = row as unknown as RequestType;
      onSaved(saved.id);
      await queryClient.invalidateQueries({ queryKey: ["request-types"] });
      await queryClient.invalidateQueries({
        queryKey: ["request-type-group-order", workspaceId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["request-type", saved.id],
      });
    },
  });
  const action = useMutation({
    mutationFn: async (kind: "publish" | "unpublish") => {
      if (!requestTypeId) return;
      if (kind === "publish") return publishRequestType(requestTypeId);
      return unpublishRequestType(requestTypeId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["request-types"] });
      if (requestTypeId)
        await queryClient.invalidateQueries({
          queryKey: ["request-type", requestTypeId],
        });
    },
  });
  const fields = draft.formSchema.fields;
  const setFields = (next: RequestTypeField[]) =>
    setDraft((current) => ({ ...current, formSchema: { fields: next } }));
  const updateField = (index: number, patch: Partial<RequestTypeField>) =>
    setDraft((current) => ({
      ...current,
      formSchema: {
        fields: current.formSchema.fields.map((field, i) =>
          i === index ? { ...field, ...patch } : field,
        ),
      },
    }));
  const reorder = (from: number, to: number) => {
    const move = <T,>(list: T[]) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      if (item !== undefined) next.splice(to, 0, item);
      return next;
    };
    setRowIds(move);
    setDraft((current) => ({
      ...current,
      formSchema: { fields: move(current.formSchema.fields) },
    }));
  };
  const titleMappingValid = isTitleMappingValid(fields);
  const priorityMappingValid = isPriorityMappingValid(fields);
  const requiredFileValid = isRequiredFileValid(fields);

  if (requestTypeId && detail.isLoading) {
    return (
      <SheetPanel>
        <p role="status">{t("loading")}</p>
      </SheetPanel>
    );
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {requestTypeId ? t("edit", { name: draft.name }) : t("create")}
        </SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>
      </SheetHeader>
      <SheetPanel className="flex flex-col gap-5">
        {(detail.isError || save.isError || action.isError) && (
          <Alert variant="error">
            <AlertDescription>{t("loadError")}</AlertDescription>
            {detail.isError ? (
              <Button variant="outline" onClick={() => void detail.refetch()}>
                {t("common:actions.retry", { defaultValue: "Retry" })}
              </Button>
            ) : null}
          </Alert>
        )}
        <RequestTypeDetailsFields
          workspaceId={workspaceId}
          draft={draft}
          setDraft={setDraft}
        />
        <div className="flex items-center justify-between">
          <h3 className="font-medium">
            {t("fields", { defaultValue: "Form fields" })}
          </h3>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => {
              setRowIds((current) => [...current, newRowId()]);
              setFields([
                ...fields,
                {
                  key: `field_${fields.length + 1}`,
                  label: t("newQuestion", { defaultValue: "New question" }),
                  type: "text",
                  required: false,
                },
              ]);
            }}
          >
            {t("addField", { defaultValue: "Add field" })}
          </Button>
        </div>
        {fields.map((field, index) => {
          const rowId = rowIds[index] ?? `row-i${index}`;
          return (
            <RequestTypeFieldRow
              key={rowId}
              field={field}
              index={index}
              fields={fields}
              optionsText={optionsText[rowId]}
              collectableFields={collectableFields}
              onChange={(patch) => updateField(index, patch)}
              onOptionsText={(raw) => {
                setOptionsText((current) => ({ ...current, [rowId]: raw }));
                updateField(index, {
                  options: raw
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                });
              }}
              onOptionsBlur={() =>
                setOptionsText((current) => {
                  const { [rowId]: _raw, ...rest } = current;
                  return rest;
                })
              }
              onMove={(to) => reorder(index, to)}
              onRemove={() => {
                setRowIds((current) => current.filter((_, i) => i !== index));
                setFields(fields.filter((_, i) => i !== index));
              }}
              onDragStart={() => setDragged(index)}
              onDrop={() => {
                if (dragged !== null) reorder(dragged, index);
                setDragged(null);
              }}
            />
          );
        })}
        <RequestTypePreview description={draft.description} fields={fields} />
        <p
          className={
            titleMappingValid
              ? "text-sm text-muted-foreground"
              : "text-sm text-destructive"
          }
        >
          {titleMappingValid
            ? t("titleMappingValid", {
                defaultValue:
                  "Exactly one required text field maps to the work item title.",
              })
            : t("titleMappingInvalid", {
                defaultValue:
                  "Publishing requires exactly one required text field mapped to the work item title.",
              })}
        </p>
        {!priorityMappingValid && (
          <p className="text-sm text-destructive" role="alert">
            {t("priorityMappingInvalid", {
              defaultValue:
                "Every priority option must map to low, medium, high, or urgent before publishing.",
            })}
          </p>
        )}
        {!requiredFileValid && (
          <p className="text-sm text-destructive" role="alert">
            {t("fileRequiredBlocked", {
              defaultValue:
                "Required file uploads are not publishable until the submission file contract is defined; clear Required to publish.",
            })}
          </p>
        )}
        {listed?.key && (
          <p className="text-xs text-muted-foreground">
            {t("opaqueKey", {
              key: listed.key,
              defaultValue: "Opaque catalogue key: {{key}}",
            })}
          </p>
        )}
        {loaded?.versions?.length ? (
          <section>
            <h3 className="font-medium">
              {t("versions", { defaultValue: "Published versions" })}
            </h3>
            <ol className="text-sm">
              {loaded.versions.map((version) => (
                <li key={version.number}>
                  {t("version", {
                    number: version.number,
                    defaultValue: "Version {{number}}",
                  })}{" "}
                  · {new Date(version.createdAt).toLocaleString()}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </SheetPanel>
      <SheetFooter>
        {requestTypeId && listed?.published && (
          <Button
            disabled={action.isPending}
            variant="outline"
            onClick={() => action.mutate("unpublish")}
          >
            {t("unpublish")}
          </Button>
        )}
        {requestTypeId && (
          <Button
            variant="outline"
            onClick={() => action.mutate("publish")}
            disabled={
              !titleMappingValid ||
              !priorityMappingValid ||
              !requiredFileValid ||
              action.isPending
            }
          >
            {listed?.published ? t("publishNew") : t("publish")}
          </Button>
        )}
        <Button
          onClick={() => save.mutate()}
          disabled={
            !draft.name.trim() ||
            !draft.group.trim() ||
            !draft.workItemTypeId ||
            save.isPending
          }
        >
          {t("save", { defaultValue: "Save draft" })}
        </Button>
      </SheetFooter>
    </>
  );
}
