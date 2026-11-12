import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { FormSchema } from "@taskdesk/domain";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useDelayedPending,
} from "@taskdesk/ui";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  SettingsAccessGate,
  useSettingsAccess,
} from "@/components/settings/settings-access";
import {
  getRequestType,
  getRequestTypes,
  publishRequestType,
  saveRequestType,
  unpublishRequestType,
} from "@/fetchers/intake";
import {
  getRequestTypeGroupOrder,
  replaceRequestTypeGroupOrder,
} from "@/fetchers/intake-group-order";
import { useCustomFields } from "@/hooks/queries/custom-field/use-custom-fields";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { resolveIntakeVisibility } from "@/lib/intake-visibility";
import { parseRequestTypeEditorSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/request-types",
)({
  validateSearch: parseRequestTypeEditorSearch,
  component: RequestTypesPage,
});

type Field = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox" | "file";
  required: boolean;
  help?: string;
  multiple?: boolean;
  options?: string[];
  mapsTo?: { field: string; map?: Record<string, string> };
  showIf?: {
    field_key: string;
    op: "eq" | "neq" | "in" | "is_set";
    value?: unknown;
  } | null;
};
const priorityValues = ["low", "medium", "high", "urgent"] as const;
type PriorityValue = (typeof priorityValues)[number];
const priorityLabels: Record<PriorityValue, string> = {
  low: "tasks:priority.low",
  medium: "tasks:priority.medium",
  high: "tasks:priority.high",
  urgent: "tasks:priority.urgent",
};
function priorityValueFor(field: Field, option: string): PriorityValue | null {
  const mapped = field.mapsTo?.map?.[option];
  if (mapped && Object.hasOwn(priorityLabels, mapped)) {
    return mapped as PriorityValue;
  }
  return Object.hasOwn(priorityLabels, option)
    ? (option as PriorityValue)
    : null;
}
type RequestType = {
  id: string;
  name: string;
  description: string | null;
  group: string;
  workItemTypeId: string;
  defaultProjectId: string | null;
  formSchema: { fields: Field[] };
  published: boolean;
  version: number;
  autoAccept: boolean;
  customerVisible: boolean;
  forcePrivate: boolean;
  position: number;
  key: string;
};
let rowCounter = 0;
const newRowId = () => `row-${++rowCounter}`;
const blank = (
  group: string,
  summary: string,
): Omit<RequestType, "id" | "version" | "published" | "key"> => ({
  name: "",
  description: "",
  group,
  workItemTypeId: "",
  defaultProjectId: null,
  formSchema: {
    fields: [
      {
        key: "title",
        label: summary,
        type: "text",
        required: true,
        mapsTo: { field: "title" },
      },
    ],
  },
  autoAccept: false,
  customerVisible: false,
  forcePrivate: false,
  position: 0,
});

function RequestTypesPage() {
  const { t } = useTranslation("requestTypes");
  const access = useSettingsAccess(
    (permission) => permission.canManageRequestTypes(),
    undefined,
    { refreshOnMount: true },
  );
  return (
    <>
      <PageTitle title={t("title")} />
      <SettingsAccessGate access={access}>
        <RequestTypesEditor />
      </SettingsAccessGate>
    </>
  );
}

function RequestTypesEditor() {
  const { t } = useTranslation(["requestTypes", "tasks"]);
  const workspace = useActiveWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const selected = Route.useSearch().requestTypeId ?? null;
  const setSelected = (id: string | null) =>
    void navigate({ search: { requestTypeId: id ?? undefined } });
  const types = useQuery({
    queryKey: ["request-types", workspace.data?.id],
    queryFn: () => getRequestTypes(workspace.data?.id ?? ""),
    enabled: Boolean(workspace.data?.id),
  });
  const groupOrder = useQuery({
    queryKey: ["request-type-group-order", workspace.data?.id],
    queryFn: () => getRequestTypeGroupOrder(workspace.data?.id ?? ""),
    enabled: Boolean(workspace.data?.id),
  });
  const workItemTypes = useGetWorkItemTypes({
    workspaceId: workspace.data?.id,
  });
  // CF-11: a form field may be mapped to a customer-visible custom field (`cf.<key>`).
  const customFields = useCustomFields(workspace.data?.id ?? "");
  const collectableFields = (customFields.data?.data ?? []).filter(
    (field) => field.customerVisible,
  );
  const [draft, setDraft] = useState<
    Omit<RequestType, "id" | "version" | "published" | "key">
  >(() => blank(t("defaultGroup"), t("defaultSummary")));
  const [dragged, setDragged] = useState<number | null>(null);
  // Stable per-row ids (parallel to draft.formSchema.fields): the field key is
  // user-editable, so keying a row by it remounted the row on every keystroke.
  const [rowIds, setRowIds] = useState<string[]>(["row-0"]);
  // Raw "Options" text while a row is being edited, so Enter and blank lines survive
  // typing; the parsed options are written on every change and the raw text is
  // dropped on blur.
  const [optionsText, setOptionsText] = useState<Record<string, string>>({});
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>(
    {},
  );
  const [groupOrderDraft, setGroupOrderDraft] = useState<string[]>([]);
  useEffect(() => {
    if (groupOrder.data) setGroupOrderDraft(groupOrder.data.groups);
  }, [groupOrder.data]);
  const detail = useQuery({
    queryKey: ["request-type", selected],
    queryFn: () => getRequestType(selected ?? ""),
    enabled: Boolean(selected),
  });
  useEffect(() => {
    const response = detail.data as unknown as RequestType | undefined;
    if (!response) return;
    setDraft({
      name: response.name,
      description: response.description,
      group: response.group,
      workItemTypeId: response.workItemTypeId,
      defaultProjectId: response.defaultProjectId,
      formSchema: response.formSchema,
      autoAccept: response.autoAccept,
      customerVisible: response.customerVisible,
      forcePrivate: response.forcePrivate,
      position: response.position,
    });
    setRowIds(response.formSchema.fields.map(() => newRowId()));
    setOptionsText({});
  }, [detail.data]);
  const save = useMutation({
    mutationFn: () =>
      saveRequestType({
        workspaceId: workspace.data?.id ?? "",
        id: selected ?? undefined,
        version: (detail.data as unknown as RequestType | undefined)?.version,
        data: draft as unknown as Record<string, unknown>,
      }),
    onSuccess: async (row) => {
      const saved = row as unknown as RequestType;
      setSelected(saved.id);
      await queryClient.invalidateQueries({ queryKey: ["request-types"] });
      await queryClient.invalidateQueries({
        queryKey: ["request-type-group-order", workspace.data?.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["request-type", saved.id],
      });
    },
  });
  const action = useMutation({
    mutationFn: async (kind: "publish" | "unpublish") => {
      if (!selected) return;
      if (kind === "publish") return publishRequestType(selected);
      return unpublishRequestType(selected);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["request-types"] });
      if (selected)
        await queryClient.invalidateQueries({
          queryKey: ["request-type", selected],
        });
    },
  });
  const saveGroupOrder = useMutation({
    mutationFn: () =>
      replaceRequestTypeGroupOrder({
        workspaceId: workspace.data?.id ?? "",
        groups: groupOrderDraft,
        version: groupOrder.data?.version ?? 1,
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(
        ["request-type-group-order", workspace.data?.id],
        saved,
      );
      setGroupOrderDraft(saved.groups);
    },
  });
  const choose = (id: string | null) => {
    setSelected(id);
    if (!id) {
      const fresh = blank(t("defaultGroup"), t("defaultSummary"));
      setDraft(fresh);
      setRowIds(fresh.formSchema.fields.map(() => newRowId()));
      setOptionsText({});
    }
  };
  const fields = draft.formSchema.fields;
  const fieldTypeLabels: Record<Field["type"], string> = {
    text: t("text", { defaultValue: "Text" }),
    textarea: t("longText", { defaultValue: "Long text" }),
    select: t("select", { defaultValue: "Select" }),
    checkbox: t("checkbox", { defaultValue: "Checkbox" }),
    file: t("file", { defaultValue: "File" }),
  };
  const mapsToLabels: Record<string, string> = {
    title: t("titleMapping", { defaultValue: "Work item title" }),
    description: t("descriptionMapping", {
      defaultValue: "Work item description",
    }),
    priority: t("priorityMapping", { defaultValue: "Work item priority" }),
  };
  const previewVisibility = resolveIntakeVisibility(
    draft.formSchema as unknown as FormSchema,
    previewValues,
  );
  const updateField = (index: number, patch: Partial<Field>) =>
    setDraft((current) => ({
      ...current,
      formSchema: {
        fields: current.formSchema.fields.map((field, i) =>
          i === index ? { ...field, ...patch } : field,
        ),
      },
    }));
  const reorder = (from: number, to: number) => {
    setRowIds((current) => {
      const next = [...current];
      const [id] = next.splice(from, 1);
      if (id) next.splice(to, 0, id);
      return next;
    });
    setDraft((current) => {
      const next = [...current.formSchema.fields];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return { ...current, formSchema: { fields: next } };
    });
  };
  const loading =
    types.isLoading || groupOrder.isLoading || workItemTypes.isLoading;
  const placeholderVisible = useDelayedPending(loading);
  const groupOrderChanged =
    groupOrder.data !== undefined &&
    (groupOrder.data.groups.length !== groupOrderDraft.length ||
      groupOrder.data.groups.some(
        (group, index) => group !== groupOrderDraft[index],
      ));
  const moveGroup = (index: number, delta: -1 | 1) => {
    setGroupOrderDraft((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const sourceGroup = next[index];
      const targetGroup = next[target];
      if (sourceGroup === undefined || targetGroup === undefined)
        return current;
      next[index] = targetGroup;
      next[target] = sourceGroup;
      return next;
    });
    saveGroupOrder.reset();
  };
  const selectedType = (
    types.data as unknown as { requestTypes: RequestType[] } | undefined
  )?.requestTypes.find((item) => item.id === selected);
  const titleMappingValid =
    fields.filter(
      (field) =>
        field.mapsTo?.field === "title" &&
        field.required &&
        (field.type === "text" || field.type === "textarea") &&
        !field.showIf,
    ).length === 1;
  const priorityMappingValid = fields.every((field) => {
    if (field.mapsTo?.field !== "priority") return true;
    if (field.type !== "select" || !field.options?.length) return false;
    return field.options.every((option) => {
      const mapped =
        field.mapsTo?.map && Object.hasOwn(field.mapsTo.map, option)
          ? field.mapsTo.map[option]
          : option;
      return ["low", "medium", "high", "urgent"].includes(mapped ?? "");
    });
  });
  const requiredFileValid = fields.every(
    (field) => field.type !== "file" || field.required !== true,
  );
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={() => void choose(null)}>{t("new")}</Button>
      </header>
      {(types.isError ||
        groupOrder.isError ||
        detail.isError ||
        save.isError ||
        action.isError ||
        workItemTypes.isError) && (
        <Alert variant="error">
          <AlertDescription>{t("loadError")}</AlertDescription>
          {(types.isError ||
            groupOrder.isError ||
            detail.isError ||
            workItemTypes.isError) && (
            <Button
              variant="outline"
              onClick={() => {
                if (types.isError) void types.refetch();
                if (groupOrder.isError) void groupOrder.refetch();
                if (detail.isError) void detail.refetch();
                if (workItemTypes.isError) void workItemTypes.refetch();
              }}
            >
              {t("common:actions.retry", { defaultValue: "Retry" })}
            </Button>
          )}
        </Alert>
      )}
      {!types.isError &&
      !groupOrder.isError &&
      !workItemTypes.isError &&
      (loading || placeholderVisible) ? (
        <p
          role="status"
          style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
        >
          {t("loading")}
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(16rem,1fr)_2fr]">
          <div className="flex min-w-0 flex-col gap-4">
            {groupOrder.data ? (
              <section
                aria-label={t("groupOrderTitle")}
                className="flex flex-col gap-3 rounded-md border p-4"
              >
                <div>
                  <h2 className="font-semibold">
                    {t("groupOrderTitle", {
                      defaultValue: "Catalogue group order",
                    })}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t("groupOrderDescription", {
                      defaultValue:
                        "Move groups independently from request type order.",
                    })}
                  </p>
                </div>
                {groupOrderDraft.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("groupOrderEmpty", {
                      defaultValue:
                        "Create a request type to add its catalogue group.",
                    })}
                  </p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {groupOrderDraft.map((group, index) => (
                      <li
                        className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                        key={group}
                      >
                        <span className="min-w-0 truncate">{group}</span>
                        {groupOrderDraft.length > 1 ? (
                          <span className="flex shrink-0 gap-1">
                            <Button
                              aria-label={t("moveGroupUp", {
                                group,
                                defaultValue: `Move ${group} up`,
                              })}
                              disabled={index === 0 || saveGroupOrder.isPending}
                              onClick={() => moveGroup(index, -1)}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <ArrowUp aria-hidden="true" className="size-4" />
                            </Button>
                            <Button
                              aria-label={t("moveGroupDown", {
                                group,
                                defaultValue: `Move ${group} down`,
                              })}
                              disabled={
                                index === groupOrderDraft.length - 1 ||
                                saveGroupOrder.isPending
                              }
                              onClick={() => moveGroup(index, 1)}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <ArrowDown
                                aria-hidden="true"
                                className="size-4"
                              />
                            </Button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
                {saveGroupOrder.isError ? (
                  <Alert variant="error" role="alert">
                    <AlertDescription>
                      {t("groupOrderSaveFailed", {
                        defaultValue:
                          "Group order could not be saved. Reload the groups and try again.",
                      })}
                    </AlertDescription>
                    <Button
                      onClick={() => void groupOrder.refetch()}
                      type="button"
                      variant="outline"
                    >
                      {t("groupOrderReload", { defaultValue: "Reload groups" })}
                    </Button>
                  </Alert>
                ) : null}
                {saveGroupOrder.isSuccess ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t("groupOrderSaved", {
                      defaultValue: "Group order saved.",
                    })}
                  </p>
                ) : null}
                {groupOrderDraft.length > 1 ? (
                  <Button
                    disabled={!groupOrderChanged || saveGroupOrder.isPending}
                    onClick={() => void saveGroupOrder.mutate()}
                    type="button"
                  >
                    {saveGroupOrder.isPending
                      ? t("savingGroupOrder", {
                          defaultValue: "Saving group order…",
                        })
                      : t("saveGroupOrder", {
                          defaultValue: "Save group order",
                        })}
                  </Button>
                ) : null}
              </section>
            ) : null}
            <nav aria-label={t("list")} className="flex flex-col gap-2">
              {(
                (
                  types.data as unknown as
                    | { requestTypes: RequestType[] }
                    | undefined
                )?.requestTypes ?? []
              ).map((item) => (
                <Button
                  key={item.id}
                  variant={selected === item.id ? "secondary" : "outline"}
                  className="h-auto justify-between"
                  onClick={() => void choose(item.id)}
                >
                  <span>{item.name}</span>
                  <span className="text-xs">
                    {item.published ? t("published") : t("draft")} · v
                    {item.version}
                  </span>
                </Button>
              ))}
              {!types.data ||
              !(types.data as unknown as { requestTypes: RequestType[] })
                .requestTypes.length ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
                    <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </nav>
          </div>
          <section
            className="flex flex-col gap-4 rounded-md border p-4"
            aria-label={t("title")}
          >
            <h2 className="font-semibold text-xl">
              {selected ? t("edit", { name: draft.name }) : t("create")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label
                className="flex flex-col gap-1"
                htmlFor="request-type-name"
              >
                {t("name")}
                <Input
                  id="request-type-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label
                className="flex flex-col gap-1"
                htmlFor="request-type-group"
              >
                {t("group")}
                <Input
                  id="request-type-group"
                  value={draft.group}
                  onChange={(e) =>
                    setDraft({ ...draft, group: e.target.value })
                  }
                />
              </label>
              <label
                className="flex flex-col gap-1 sm:col-span-2"
                htmlFor="request-type-description"
              >
                {t("summary")}
                <Textarea
                  id="request-type-description"
                  value={draft.description ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
              <label
                className="flex flex-col gap-1"
                htmlFor="request-type-work-item-type"
              >
                {t("workItemType")}
                <Select
                  value={draft.workItemTypeId || null}
                  onValueChange={(value) =>
                    setDraft({ ...draft, workItemTypeId: value ?? "" })
                  }
                >
                  <SelectTrigger id="request-type-work-item-type">
                    <SelectValue placeholder={t("chooseType")}>
                      {
                        workItemTypes.data?.find(
                          (type) => type.id === draft.workItemTypeId,
                        )?.name
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {workItemTypes.data?.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label
                className="flex flex-col gap-1"
                htmlFor="request-type-project"
              >
                {t("projectId")}
                <Input
                  id="request-type-project"
                  value={draft.defaultProjectId ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      defaultProjectId: e.target.value || null,
                    })
                  }
                />
              </label>
              <label
                className="flex flex-col gap-1"
                htmlFor="request-type-position"
              >
                {t("catalogueOrder", {
                  defaultValue: "Catalogue order within group",
                })}
                <Input
                  id="request-type-position"
                  type="number"
                  min={0}
                  value={draft.position}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      position: Math.max(0, Number(e.target.value)),
                    })
                  }
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label htmlFor="request-type-customer-visible">
                <Checkbox
                  id="request-type-customer-visible"
                  checked={draft.customerVisible}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, customerVisible: Boolean(checked) })
                  }
                />{" "}
                {t("visible", { defaultValue: "Visible to customers" })}
              </label>
              <label htmlFor="request-type-auto-accept">
                <Checkbox
                  id="request-type-auto-accept"
                  checked={draft.autoAccept}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, autoAccept: Boolean(checked) })
                  }
                />{" "}
                {t("autoAccept", { defaultValue: "Auto accept" })}
              </label>
              <label htmlFor="request-type-force-private">
                <Checkbox
                  id="request-type-force-private"
                  checked={draft.forcePrivate}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, forcePrivate: Boolean(checked) })
                  }
                />{" "}
                {t("forcePrivate", {
                  defaultValue: "Keep submissions private",
                })}
              </label>
            </div>
            <div className="flex items-center justify-between">
              <h3 className="font-medium">
                {t("fields", { defaultValue: "Form fields" })}
              </h3>
              <Button
                variant="outline"
                onClick={() => {
                  setRowIds((current) => [...current, newRowId()]);
                  setDraft({
                    ...draft,
                    formSchema: {
                      fields: [
                        ...fields,
                        {
                          key: `field_${fields.length + 1}`,
                          label: t("newQuestion"),
                          type: "text",
                          required: false,
                        },
                      ],
                    },
                  });
                }}
              >
                {t("addField", { defaultValue: "Add field" })}
              </Button>
            </div>
            {fields.map((field, index) => {
              const rowId = rowIds[index] ?? `row-i${index}`;
              return (
                <article
                  key={rowId}
                  draggable
                  onDragStart={() => setDragged(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragged !== null) reorder(dragged, index);
                    setDragged(null);
                  }}
                  className="grid gap-2 rounded border p-3 sm:grid-cols-[1fr_1fr_auto_auto]"
                >
                  <label htmlFor={`field-key-${index}`}>
                    {t("fieldKey", { defaultValue: "Field key" })}
                    <Input
                      id={`field-key-${index}`}
                      value={field.key}
                      onChange={(e) =>
                        updateField(index, { key: e.target.value })
                      }
                    />
                  </label>
                  <label htmlFor={`field-label-${index}`}>
                    {t("label", { defaultValue: "Customer label" })}
                    <Input
                      id={`field-label-${index}`}
                      value={field.label}
                      onChange={(e) =>
                        updateField(index, { label: e.target.value })
                      }
                    />
                  </label>
                  <label htmlFor={`field-type-${index}`}>
                    {t("type", { defaultValue: "Type" })}
                    <Select
                      value={field.type}
                      onValueChange={(value) =>
                        value &&
                        updateField(index, { type: value as Field["type"] })
                      }
                    >
                      <SelectTrigger id={`field-type-${index}`}>
                        <SelectValue>{fieldTypeLabels[field.type]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">
                          {t("text", { defaultValue: "Text" })}
                        </SelectItem>
                        <SelectItem value="textarea">
                          {t("longText", { defaultValue: "Long text" })}
                        </SelectItem>
                        <SelectItem value="select">
                          {t("select", { defaultValue: "Select" })}
                        </SelectItem>
                        <SelectItem value="checkbox">
                          {t("checkbox", { defaultValue: "Checkbox" })}
                        </SelectItem>
                        <SelectItem value="file">
                          {t("file", { defaultValue: "File" })}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label
                    className="flex items-center gap-2"
                    htmlFor={`field-required-${index}`}
                  >
                    <Checkbox
                      id={`field-required-${index}`}
                      checked={field.required}
                      disabled={field.type === "file" && !field.required}
                      onCheckedChange={(checked) =>
                        updateField(index, { required: Boolean(checked) })
                      }
                    />{" "}
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
                        ? t("requiredFileInvalid")
                        : t("requiredFileUnavailable")}
                    </p>
                  )}
                  <label
                    className="sm:col-span-2"
                    htmlFor={`field-help-${index}`}
                  >
                    {t("help", { defaultValue: "Help text" })}
                    <Input
                      id={`field-help-${index}`}
                      value={field.help ?? ""}
                      onChange={(e) =>
                        updateField(index, {
                          help: e.target.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label
                    className="sm:col-span-2"
                    htmlFor={`field-options-${index}`}
                  >
                    {t("options", { defaultValue: "Options (one per line)" })}
                    <Textarea
                      id={`field-options-${index}`}
                      value={
                        optionsText[rowId] ?? (field.options ?? []).join("\n")
                      }
                      onChange={(e) => {
                        const raw = e.target.value;
                        setOptionsText((current) => ({
                          ...current,
                          [rowId]: raw,
                        }));
                        updateField(index, {
                          options: raw
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean),
                        });
                      }}
                      onBlur={() =>
                        setOptionsText((current) => {
                          const { [rowId]: _raw, ...rest } = current;
                          return rest;
                        })
                      }
                      disabled={field.type !== "select"}
                    />
                  </label>
                  <label htmlFor={`field-maps-to-${index}`}>
                    {t("mapsTo", { defaultValue: "Maps to" })}
                    <Select
                      value={field.mapsTo?.field ?? "__none__"}
                      onValueChange={(value) =>
                        updateField(index, {
                          mapsTo:
                            value && value !== "__none__"
                              ? { field: value }
                              : undefined,
                        })
                      }
                    >
                      <SelectTrigger id={`field-maps-to-${index}`}>
                        <SelectValue
                          placeholder={t("unmapped", {
                            defaultValue: "Keep in request data",
                          })}
                        >
                          {field.mapsTo?.field
                            ? (mapsToLabels[field.mapsTo.field] ??
                              collectableFields.find(
                                (candidate) =>
                                  `cf.${candidate.key}` === field.mapsTo?.field,
                              )?.name ??
                              field.mapsTo.field)
                            : t("unmapped", {
                                defaultValue: "Keep in request data",
                              })}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value="__none__">
                          {t("unmapped", {
                            defaultValue: "Keep in request data",
                          })}
                        </SelectItem>
                        <SelectItem value="title">
                          {t("titleMapping", {
                            defaultValue: "Work item title",
                          })}
                        </SelectItem>
                        <SelectItem value="description">
                          {t("descriptionMapping", {
                            defaultValue: "Work item description",
                          })}
                        </SelectItem>
                        <SelectItem value="priority">
                          {t("priorityMapping", {
                            defaultValue: "Work item priority",
                          })}
                        </SelectItem>
                        {collectableFields.map((candidate) => (
                          <SelectItem
                            key={candidate.id}
                            value={`cf.${candidate.key}`}
                          >
                            {candidate.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  {field.type === "select" &&
                    field.mapsTo?.field === "priority" && (
                      <fieldset className="flex flex-col gap-2 sm:col-span-2">
                        <legend className="font-medium">
                          {t("priorityValueMapping", {
                            defaultValue: "Priority value mapping",
                          })}
                        </legend>
                        {field.options?.map((option) => (
                          <label
                            key={option}
                            className="grid gap-2 sm:grid-cols-2"
                            htmlFor={`field-map-${index}-${option}`}
                          >
                            <span>{option}</span>
                            <Select
                              value={priorityValueFor(field, option)}
                              onValueChange={(value) => {
                                const map = { ...(field.mapsTo?.map ?? {}) };
                                if (value) map[option] = value;
                                else delete map[option];
                                updateField(index, {
                                  mapsTo: { field: "priority", map },
                                });
                              }}
                            >
                              <SelectTrigger
                                id={`field-map-${index}-${option}`}
                              >
                                <SelectValue
                                  placeholder={t("choosePriority", {
                                    defaultValue: "Choose priority",
                                  })}
                                >
                                  {(() => {
                                    const val = priorityValueFor(field, option);
                                    if (val === "low")
                                      return t("tasks:priority.low");
                                    if (val === "medium")
                                      return t("tasks:priority.medium");
                                    if (val === "high")
                                      return t("tasks:priority.high");
                                    if (val === "urgent")
                                      return t("tasks:priority.urgent");
                                    return undefined;
                                  })()}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="low">
                                  {t("tasks:priority.low")}
                                </SelectItem>
                                <SelectItem value="medium">
                                  {t("tasks:priority.medium")}
                                </SelectItem>
                                <SelectItem value="high">
                                  {t("tasks:priority.high")}
                                </SelectItem>
                                <SelectItem value="urgent">
                                  {t("tasks:priority.urgent")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </label>
                        ))}
                      </fieldset>
                    )}
                  <label htmlFor={`field-show-when-${index}`}>
                    {t("showWhen", { defaultValue: "Show when" })}
                    <Select
                      value={field.showIf?.field_key ?? "__always__"}
                      onValueChange={(value) => {
                        if (!value || value === "__always__") {
                          updateField(index, { showIf: undefined });
                        } else {
                          const target = fields.find((f) => f.key === value);
                          updateField(index, {
                            showIf: {
                              field_key: value,
                              op: "eq",
                              value: target?.type === "checkbox" ? true : "",
                            },
                          });
                        }
                      }}
                    >
                      <SelectTrigger id={`field-show-when-${index}`}>
                        <SelectValue
                          placeholder={t("always", {
                            defaultValue: "Always visible",
                          })}
                        >
                          {field.showIf
                            ? fields.find(
                                (candidate) =>
                                  candidate.key === field.showIf?.field_key,
                              )?.label
                            : t("always", { defaultValue: "Always visible" })}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__always__">
                          {t("always", {
                            defaultValue: "Always visible",
                          })}
                        </SelectItem>
                        {fields
                          .filter((candidate) => candidate.key !== field.key)
                          .map((candidate) => (
                            <SelectItem
                              key={candidate.key}
                              value={candidate.key}
                            >
                              {candidate.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </label>
                  {field.showIf && (
                    <label htmlFor={`field-show-value-${index}`}>
                      {t("equals", { defaultValue: "Equals value" })}
                      {fields.find((f) => f.key === field.showIf?.field_key)
                        ?.type === "checkbox" ? (
                        <Select
                          value={String(
                            field.showIf.value === true ||
                              field.showIf.value === "true",
                          )}
                          onValueChange={(val) =>
                            updateField(index, {
                              showIf: {
                                ...(field.showIf ?? {
                                  field_key: "",
                                  op: "eq",
                                }),
                                value: val === "true",
                              },
                            })
                          }
                        >
                          <SelectTrigger id={`field-show-value-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">
                              {t("common:boolean.true", {
                                defaultValue: "True",
                              })}
                            </SelectItem>
                            <SelectItem value="false">
                              {t("common:boolean.false", {
                                defaultValue: "False",
                              })}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={`field-show-value-${index}`}
                          value={String(field.showIf.value ?? "")}
                          onChange={(e) =>
                            updateField(index, {
                              showIf: {
                                ...(field.showIf ?? {
                                  field_key: "",
                                  op: "eq",
                                }),
                                value: e.target.value,
                              },
                            })
                          }
                        />
                      )}
                    </label>
                  )}
                  {field.type === "file" && (
                    <label
                      className="flex items-center gap-2"
                      htmlFor={`field-multiple-${index}`}
                    >
                      <Checkbox
                        id={`field-multiple-${index}`}
                        checked={field.multiple ?? false}
                        onCheckedChange={(checked) =>
                          updateField(index, { multiple: Boolean(checked) })
                        }
                      />{" "}
                      {t("multiple", { defaultValue: "Allow multiple files" })}
                    </label>
                  )}
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      aria-label={t("moveUp", {
                        name: field.label,
                        defaultValue: `Move ${field.label} up`,
                      })}
                      disabled={index === 0}
                      onClick={() => reorder(index, index - 1)}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="outline"
                      aria-label={t("moveDown", {
                        name: field.label,
                        defaultValue: `Move ${field.label} down`,
                      })}
                      disabled={index === fields.length - 1}
                      onClick={() => reorder(index, index + 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="destructive"
                      aria-label={t("removeField", {
                        name: field.label,
                        defaultValue: `Remove ${field.label}`,
                      })}
                      onClick={() => {
                        setRowIds((current) =>
                          current.filter((_, i) => i !== index),
                        );
                        setDraft({
                          ...draft,
                          formSchema: {
                            fields: fields.filter((_, i) => i !== index),
                          },
                        });
                      }}
                    >
                      {t("remove", { defaultValue: "Remove" })}
                    </Button>
                  </div>
                </article>
              );
            })}
            <section className="rounded-md bg-muted p-4">
              <h3 className="font-medium">
                {t("preview", { defaultValue: "Customer preview" })}
              </h3>
              <p className="text-sm text-muted-foreground">
                {draft.description ||
                  t("previewDescription", {
                    defaultValue: "Request form description",
                  })}
              </p>
              <div className="mt-3 grid gap-3">
                {fields
                  .filter((field) => previewVisibility.get(field.key) ?? true)
                  .map((field) => (
                    <div key={field.key} className="flex flex-col gap-1">
                      {field.label}
                      {field.required ? " *" : ""}
                      {field.type === "textarea" ? (
                        <Textarea
                          aria-label={field.label}
                          placeholder={field.help}
                          value={String(previewValues[field.key] ?? "")}
                          onChange={(event) =>
                            setPreviewValues({
                              ...previewValues,
                              [field.key]: event.target.value,
                            })
                          }
                        />
                      ) : field.type === "select" ? (
                        <Select
                          value={String(previewValues[field.key] ?? "") || null}
                          onValueChange={(value) =>
                            setPreviewValues({
                              ...previewValues,
                              [field.key]: value ?? "",
                            })
                          }
                        >
                          <SelectTrigger aria-label={field.label}>
                            <SelectValue
                              placeholder={t("choose", {
                                defaultValue: "Choose…",
                              })}
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
                          checked={Boolean(previewValues[field.key])}
                          onCheckedChange={(checked) =>
                            setPreviewValues({
                              ...previewValues,
                              [field.key]: Boolean(checked),
                            })
                          }
                        />
                      ) : (
                        <Input
                          type="text"
                          aria-label={field.label}
                          value={String(previewValues[field.key] ?? "")}
                          onChange={(event) =>
                            setPreviewValues({
                              ...previewValues,
                              [field.key]: event.target.value,
                            })
                          }
                        />
                      )}
                    </div>
                  ))}
              </div>
            </section>
            <p
              className={
                titleMappingValid
                  ? "text-sm text-muted-foreground"
                  : "text-sm text-destructive"
              }
            >
              {titleMappingValid
                ? t("titleMappingValid")
                : t("titleMappingInvalid")}
            </p>
            {!priorityMappingValid && (
              <p className="text-sm text-destructive" role="alert">
                {t("priorityMappingInvalid")}
              </p>
            )}
            {!requiredFileValid && (
              <p className="text-sm text-destructive" role="alert">
                {t("requiredFileInvalid")}
              </p>
            )}
            {selectedType?.key && (
              <p className="text-xs text-muted-foreground">
                {t("opaqueKey", { key: selectedType.key })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => save.mutate()}
                disabled={
                  !draft.name.trim() ||
                  !draft.group.trim() ||
                  !draft.workItemTypeId ||
                  save.isPending
                }
              >
                {t("save")}
              </Button>
              {selected && (
                <Button
                  onClick={() => action.mutate("publish")}
                  disabled={
                    !titleMappingValid ||
                    !priorityMappingValid ||
                    !requiredFileValid ||
                    action.isPending
                  }
                >
                  {selectedType?.published ? t("publishNew") : t("publish")}
                </Button>
              )}
              {selected && selectedType?.published && (
                <Button
                  variant="outline"
                  onClick={() => action.mutate("unpublish")}
                >
                  {t("unpublish")}
                </Button>
              )}
            </div>
            {(
              detail.data as unknown as
                | { versions?: Array<{ number: number; createdAt: string }> }
                | undefined
            )?.versions?.length ? (
              <section>
                <h3 className="font-medium">{t("versions")}</h3>
                <ol className="text-sm">
                  {(
                    detail.data as unknown as {
                      versions: Array<{ number: number; createdAt: string }>;
                    }
                  ).versions.map((version) => (
                    <li key={version.number}>
                      {t("version", { number: version.number })} ·{" "}
                      {new Date(version.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
