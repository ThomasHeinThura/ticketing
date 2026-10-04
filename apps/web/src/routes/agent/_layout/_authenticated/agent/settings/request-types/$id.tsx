import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { FormSchema, FormValue } from "@taskdesk/domain/intake";
import { requestTypeClient } from "@taskdesk/libs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from "@taskdesk/ui";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  GripVertical,
  Plus,
  Save,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { RequestTypeFields } from "@/components/request-type/request-type-fields";
import getProjects from "@/fetchers/project/get-projects";
import {
  getRequestTypeErrorMessage,
  getRequestTypes,
} from "@/fetchers/request-type";
import getAssignablePeople from "@/fetchers/work-item/get-assignable-people";
import getWorkItemTypes from "@/fetchers/work-item/get-work-item-types";
import { useSlaPolicies } from "@/hooks/queries/sla-policy/use-sla-policies";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/request-types/$id",
)({ component: RequestTypeEditorRoute });

type Draft = {
  name: string;
  description: string;
  group: string;
  workItemTypeId: string;
  defaultProjectId: string | null;
  defaultAssigneeId: string | null;
  slaPolicyId: string | null;
  autoAccept: boolean;
  customerVisible: boolean;
  forcePrivate: boolean;
  formSchema: FormSchema;
};
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function mutableJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  )
    return value;
  if (Array.isArray(value)) return value.map(mutableJson);
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, mutableJson(child)]),
    );
  throw new Error("Form condition contains a non-JSON value");
}

const emptyDraft: Draft = {
  name: "",
  description: "",
  group: "General",
  workItemTypeId: "",
  defaultProjectId: null,
  defaultAssigneeId: null,
  slaPolicyId: null,
  autoAccept: false,
  customerVisible: false,
  forcePrivate: false,
  formSchema: {
    fields: [
      {
        key: "summary",
        type: "text",
        label: "Summary",
        required: true,
        mapsTo: { field: "title" },
      },
    ],
  },
};

function mutableFormSchema(schema: FormSchema) {
  return {
    fields: schema.fields.map((field) => ({
      ...field,
      options: field.options ? [...field.options] : undefined,
      mapsTo: field.mapsTo
        ? {
            ...field.mapsTo,
            map: field.mapsTo.map ? { ...field.mapsTo.map } : undefined,
          }
        : undefined,
      showIf: field.showIf
        ? {
            field_key: field.showIf.field_key,
            op: field.showIf.op,
            ...(field.showIf.value === undefined
              ? {}
              : { value: mutableJson(field.showIf.value) }),
          }
        : field.showIf,
    })),
  };
}

function nextFieldKey(fields: FormSchema["fields"]): string {
  const keys = new Set(fields.map((field) => field.key));
  let suffix = fields.length + 1;
  while (keys.has(`field_${suffix}`)) suffix += 1;
  return `field_${suffix}`;
}

function RequestTypeEditorRoute() {
  const { id } = Route.useParams();
  const isNew = id === "new";
  const { t } = useTranslation("requestTypes");
  const { data: workspace } = useActiveWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { canManageRequestTypes, isCheckingPermissions } =
    useWorkspacePermission(workspace?.id ?? null);
  const allowed = canManageRequestTypes();
  const listQuery = useQuery({
    queryKey: ["request-types", workspace?.id ?? ""],
    queryFn: () => getRequestTypes(workspace?.id ?? ""),
    enabled: Boolean(workspace?.id && !isNew),
  });
  const typeQuery = useQuery({
    queryKey: ["work-item-types", workspace?.id ?? ""],
    queryFn: () => getWorkItemTypes(workspace?.id ?? ""),
    enabled: Boolean(workspace?.id),
  });
  const projectsQuery = useQuery({
    queryKey: ["projects", workspace?.id ?? ""],
    queryFn: () => getProjects({ workspaceId: workspace!.id }),
    enabled: Boolean(workspace?.id),
  });
  const policiesQuery = useSlaPolicies(workspace?.id ?? "");
  const item = listQuery.data?.items.find((candidate) => candidate.id === id);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [previewValues, setPreviewValues] = useState<Record<string, FormValue>>(
    {},
  );
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const assigneesQuery = useQuery({
    queryKey: ["assignable-people", draft.defaultProjectId ?? ""],
    queryFn: () => getAssignablePeople(draft.defaultProjectId!),
    enabled: Boolean(draft.defaultProjectId),
  });

  useEffect(() => {
    if (isNew && !initialized) {
      setDraft((current) => ({
        ...current,
        workItemTypeId: typeQuery.data?.[0]?.id ?? "",
      }));
      if (typeQuery.data) setInitialized(true);
    } else if (item && !initialized) {
      setDraft({
        name: item.name,
        description: item.description ?? "",
        group: item.group,
        workItemTypeId: item.workItemTypeId,
        defaultProjectId: item.defaultProjectId,
        defaultAssigneeId: item.defaultAssigneeId,
        slaPolicyId: item.slaPolicyId,
        autoAccept: item.autoAccept,
        customerVisible: item.customerVisible,
        forcePrivate: item.forcePrivate,
        formSchema: item.formSchema as FormSchema,
      });
      setInitialized(true);
    } else if (!isNew && workspace && !listQuery.isLoading) {
      setInitialized(true);
    }
  }, [
    initialized,
    isNew,
    item,
    listQuery.isLoading,
    typeQuery.data,
    workspace,
  ]);

  const save = useMutation({
    mutationFn: async () => {
      if (!workspace?.id) throw new Error("Workspace is unavailable");
      const body = {
        name: draft.name.trim(),
        description: draft.description || null,
        icon: item?.icon ?? null,
        group: draft.group.trim(),
        workItemTypeId: draft.workItemTypeId,
        defaultProjectId: draft.defaultProjectId,
        formSchema: mutableFormSchema(draft.formSchema),
        slaPolicyId: draft.slaPolicyId,
        defaultAssigneeId: draft.defaultAssigneeId,
        autoAccept: draft.autoAccept,
        customerVisible: draft.customerVisible,
        forcePrivate: draft.forcePrivate,
        position: item?.position ?? 0,
      };
      return isNew
        ? requestTypeClient.create({ ...body, workspaceId: workspace.id })
        : requestTypeClient.update(id, body);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ["request-types", workspace?.id ?? ""],
      });
      setError(null);
      setSaved(true);
      if (isNew)
        await navigate({
          to: routes.requestTypeEditor.path,
          params: { id: result.id },
        });
    },
    onError: (cause) => {
      setSaved(false);
      setError(getRequestTypeErrorMessage(cause, t("editor.saveError")));
    },
  });
  const publish = useMutation({
    mutationFn: () =>
      item?.published
        ? requestTypeClient.unpublish(id)
        : requestTypeClient.publish(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["request-types", workspace?.id ?? ""],
      });
      setError(null);
    },
    onError: (cause) =>
      setError(getRequestTypeErrorMessage(cause, t("editor.publishError"))),
  });

  function updateField(
    index: number,
    patch: Partial<FormSchema["fields"][number]>,
  ) {
    setDraft((current) => ({
      ...current,
      formSchema: {
        fields: current.formSchema.fields.map((field, fieldIndex) => {
          if (fieldIndex === index) return { ...field, ...patch };
          if (
            typeof patch.key === "string" &&
            field.showIf?.field_key === current.formSchema.fields[index]?.key
          ) {
            return {
              ...field,
              showIf: { ...field.showIf, field_key: patch.key },
            };
          }
          return field;
        }),
      },
    }));
    setSaved(false);
  }
  function moveField(from: number, to: number) {
    if (to < 0 || to >= draft.formSchema.fields.length) return;
    setDraft((current) => {
      const fields = [...current.formSchema.fields];
      const [field] = fields.splice(from, 1);
      fields.splice(to, 0, field!);
      return { ...current, formSchema: { fields } };
    });
    setSaved(false);
  }

  if (!isCheckingPermissions && !allowed)
    return (
      <main className="p-6">
        <Alert variant="error">
          <AlertTitle>{t("title")}</AlertTitle>
          <AlertDescription>{t("readOnly")}</AlertDescription>
        </Alert>
      </main>
    );
  if (!workspace || (!isNew && (listQuery.isLoading || !initialized)))
    return (
      <main className="space-y-4 p-6" role="status">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </main>
    );
  if (!isNew && (listQuery.isError || !item))
    return (
      <main className="p-6">
        <Alert variant="error">
          <AlertTitle>{t("loadError")}</AlertTitle>
          <AlertDescription>{t("loadError")}</AlertDescription>
        </Alert>
      </main>
    );

  return (
    <>
      <PageTitle title={isNew ? t("editor.newTitle") : t("editor.title")} />
      <main className="grid h-full gap-6 overflow-y-auto p-6 xl:grid-cols-2">
        <section className="space-y-5">
          <Button
            variant="ghost"
            render={<Link to={routes.requestTypes.path} />}
          >
            <ChevronLeft aria-hidden="true" />
            {t("editor.back")}
          </Button>
          <header>
            <h1 className="text-2xl font-semibold">
              {isNew ? t("editor.newTitle") : t("editor.title")}
            </h1>
          </header>
          {error ? (
            <Alert variant="error">
              <AlertTitle>{t("editor.saveError")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{t("editor.title")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="request-type-name">{t("editor.name")}</Label>
                <Input
                  id="request-type-name"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.currentTarget.value })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="request-type-description">
                  {t("editor.description")}
                </Label>
                <Textarea
                  id="request-type-description"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      description: event.currentTarget.value,
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="request-type-group">{t("editor.group")}</Label>
                <Input
                  id="request-type-group"
                  value={draft.group}
                  onChange={(event) =>
                    setDraft({ ...draft, group: event.currentTarget.value })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="request-type-work-item-type">
                  {t("editor.workItemType")}
                </Label>
                <Select
                  value={draft.workItemTypeId}
                  onValueChange={(value) =>
                    setDraft({ ...draft, workItemTypeId: value ?? "" })
                  }
                >
                  <SelectTrigger id="request-type-work-item-type">
                    <SelectValue placeholder={t("editor.workItemType")} />
                  </SelectTrigger>
                  <SelectContent>
                    {typeQuery.data?.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="request-type-default-project">
                  {t("editor.defaultProject")}
                </Label>
                <Select
                  value={draft.defaultProjectId ?? "none"}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      defaultProjectId: value === "none" ? null : value,
                      defaultAssigneeId:
                        value === current.defaultProjectId
                          ? current.defaultAssigneeId
                          : null,
                    }))
                  }
                >
                  <SelectTrigger id="request-type-default-project">
                    <SelectValue placeholder={t("editor.defaultProject")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {t("editor.noDefaultProject")}
                    </SelectItem>
                    {projectsQuery.data?.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="request-type-default-assignee">
                  {t("editor.defaultAssignee")}
                </Label>
                <Select
                  value={draft.defaultAssigneeId ?? "none"}
                  disabled={!draft.defaultProjectId || assigneesQuery.isLoading}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      defaultAssigneeId: value === "none" ? null : value,
                    })
                  }
                >
                  <SelectTrigger id="request-type-default-assignee">
                    <SelectValue placeholder={t("editor.defaultAssignee")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {t("editor.noDefaultAssignee")}
                    </SelectItem>
                    {assigneesQuery.data?.map((person) => (
                      <SelectItem key={person.personId} value={person.personId}>
                        {person.name ?? person.personId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {assigneesQuery.isError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {t("editor.assigneesUnavailable")}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="request-type-sla-policy">
                  {t("editor.slaPolicy")}
                </Label>
                <Select
                  value={draft.slaPolicyId ?? "none"}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      slaPolicyId: value === "none" ? null : value,
                    })
                  }
                >
                  <SelectTrigger id="request-type-sla-policy">
                    <SelectValue placeholder={t("editor.slaPolicy")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {t("editor.noSlaPolicy")}
                    </SelectItem>
                    {policiesQuery.data?.data.map((policy) => (
                      <SelectItem key={policy.id} value={policy.id}>
                        {policy.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.customerVisible}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      customerVisible: event.currentTarget.checked,
                    })
                  }
                />
                {t("editor.customerVisible")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.autoAccept}
                  disabled={!draft.defaultProjectId}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      autoAccept: event.currentTarget.checked,
                    })
                  }
                />
                {t("editor.autoAccept")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.forcePrivate}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      forcePrivate: event.currentTarget.checked,
                    })
                  }
                />
                {t("editor.forcePrivate")}
              </label>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t("editor.form")}</CardTitle>
                <Button
                  variant="outline"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      formSchema: {
                        fields: [
                          ...current.formSchema.fields,
                          {
                            key: nextFieldKey(current.formSchema.fields),
                            type: "text",
                            label: "",
                            required: false,
                          },
                        ],
                      },
                    }))
                  }
                >
                  <Plus aria-hidden="true" />
                  {t("editor.addField")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {draft.formSchema.fields.map((field, index) => (
                  <li
                    key={field.key}
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/plain", String(index))
                    }
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = Number(
                        event.dataTransfer.getData("text/plain"),
                      );
                      if (Number.isInteger(from)) moveField(from, index);
                    }}
                    className="grid gap-3 rounded-md border p-3 md:grid-cols-[auto_1fr_auto]"
                  >
                    <GripVertical
                      aria-label={t("editor.moveFieldUp")}
                      className="mt-2 text-muted-foreground"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor={`field-label-${index}`}>
                          {t("editor.fieldLabel")}
                        </Label>
                        <Input
                          id={`field-label-${index}`}
                          value={field.label}
                          onChange={(event) =>
                            updateField(index, {
                              label: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`field-key-${index}`}>
                          {t("editor.fieldKey")}
                        </Label>
                        <Input
                          id={`field-key-${index}`}
                          value={field.key}
                          disabled={field.mapsTo?.field === "title"}
                          onChange={(event) =>
                            updateField(index, {
                              key: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                      <div className="grid gap-2 sm:col-span-2">
                        <Label htmlFor={`field-help-${index}`}>
                          {t("editor.helpText")}
                        </Label>
                        <Input
                          id={`field-help-${index}`}
                          value={field.help ?? ""}
                          onChange={(event) =>
                            updateField(index, {
                              help: event.currentTarget.value || undefined,
                            })
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>{t("editor.fieldType")}</Label>
                        <Select
                          value={field.type}
                          disabled={field.mapsTo?.field === "title"}
                          onValueChange={(value) =>
                            updateField(index, {
                              type: value as typeof field.type,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[
                              "text",
                              "textarea",
                              "select",
                              "combobox",
                              "number",
                              "date",
                              "checkbox",
                              "file",
                            ].map((kind) => (
                              <SelectItem key={kind} value={kind}>
                                {kind}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <label className="flex items-center gap-2 self-end text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(field.required)}
                          disabled={field.mapsTo?.field === "title"}
                          onChange={(event) =>
                            updateField(index, {
                              required: event.currentTarget.checked,
                            })
                          }
                        />
                        {t("editor.required")}
                      </label>
                      {field.type === "select" || field.type === "combobox" ? (
                        <div className="grid gap-2 sm:col-span-2">
                          <Label htmlFor={`field-options-${index}`}>
                            {t("editor.options")}
                          </Label>
                          <Textarea
                            id={`field-options-${index}`}
                            value={(field.options ?? []).join("\n")}
                            onChange={(event) =>
                              updateField(index, {
                                options: event.currentTarget.value
                                  .split("\n")
                                  .map((option) => option.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </div>
                      ) : null}
                      {field.type === "select" ||
                      field.type === "combobox" ||
                      field.type === "file" ? (
                        <label className="flex items-center gap-2 text-sm sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={Boolean(field.multiple)}
                            onChange={(event) =>
                              updateField(index, {
                                multiple: event.currentTarget.checked,
                              })
                            }
                          />
                          {t("editor.allowMultiple")}
                        </label>
                      ) : null}
                      <div className="grid gap-2 sm:col-span-2">
                        <Label htmlFor={`field-maps-to-${index}`}>
                          {t("editor.mapsTo")}
                        </Label>
                        <Select
                          value={
                            field.mapsTo?.field.startsWith("cf.")
                              ? "custom_field"
                              : (field.mapsTo?.field ?? "none")
                          }
                          onValueChange={(value) =>
                            updateField(index, {
                              mapsTo:
                                !value || value === "none"
                                  ? undefined
                                  : {
                                      field:
                                        value === "custom_field"
                                          ? "cf."
                                          : value,
                                    },
                            })
                          }
                        >
                          <SelectTrigger id={`field-maps-to-${index}`}>
                            <SelectValue placeholder={t("editor.mapsTo")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              {t("editor.noMapping")}
                            </SelectItem>
                            {[
                              ["title", t("editor.nativeTitle")],
                              ["description", t("editor.nativeDescription")],
                              ["priority", t("editor.nativePriority")],
                              ["due_date", t("editor.nativeDueDate")],
                            ].map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                            <SelectItem value="custom_field">
                              {t("editor.customField")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {field.mapsTo?.field.startsWith("cf.") ? (
                        <div className="grid gap-2 sm:col-span-2">
                          <Label htmlFor={`field-custom-target-${index}`}>
                            {t("editor.customFieldKey")}
                          </Label>
                          <Input
                            id={`field-custom-target-${index}`}
                            value={field.mapsTo.field.slice(3)}
                            placeholder={t("editor.customFieldKeyPlaceholder")}
                            onChange={(event) =>
                              updateField(index, {
                                mapsTo: {
                                  ...(field.mapsTo ?? {}),
                                  field: `cf.${event.currentTarget.value.trim()}`,
                                },
                              })
                            }
                          />
                        </div>
                      ) : null}
                      {field.mapsTo?.field !== "title" &&
                      field.mapsTo?.field !== "description" &&
                      (field.type === "select" || field.type === "combobox") ? (
                        <div className="grid gap-2 sm:col-span-2">
                          <Label htmlFor={`field-map-${index}`}>
                            {t("editor.valueMapping")}
                          </Label>
                          <Textarea
                            id={`field-map-${index}`}
                            value={Object.entries(field.mapsTo?.map ?? {})
                              .map(
                                ([source, target]) => `${source} = ${target}`,
                              )
                              .join("\n")}
                            placeholder={t("editor.valueMappingPlaceholder")}
                            onChange={(event) => {
                              const mapping = Object.fromEntries(
                                event.currentTarget.value
                                  .split("\n")
                                  .map((line) => line.split("="))
                                  .filter((parts) => parts.length >= 2)
                                  .map(([source, ...target]) => [
                                    source!.trim(),
                                    target.join("=").trim(),
                                  ])
                                  .filter(
                                    ([source, target]) => source && target,
                                  ),
                              );
                              updateField(index, {
                                mapsTo: { ...field.mapsTo!, map: mapping },
                              });
                            }}
                          />
                        </div>
                      ) : null}
                      <div className="grid gap-2 sm:col-span-2">
                        <Label htmlFor={`field-show-if-${index}`}>
                          {t("editor.conditionalVisibility")}
                        </Label>
                        <Select
                          value={field.showIf?.field_key ?? "none"}
                          onValueChange={(value) =>
                            updateField(index, {
                              showIf:
                                !value || value === "none"
                                  ? undefined
                                  : { field_key: value, op: "is_set" },
                            })
                          }
                        >
                          <SelectTrigger id={`field-show-if-${index}`}>
                            <SelectValue
                              placeholder={t("editor.conditionalVisibility")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              {t("editor.alwaysVisible")}
                            </SelectItem>
                            {draft.formSchema.fields
                              .filter(
                                (candidate) =>
                                  candidate.key !== field.key &&
                                  candidate.type !== "file" &&
                                  !candidate.showIf,
                              )
                              .map((candidate) => (
                                <SelectItem
                                  key={candidate.key}
                                  value={candidate.key}
                                >
                                  {candidate.label || candidate.key}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {field.showIf ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Select
                              value={field.showIf.op}
                              onValueChange={(value) =>
                                updateField(index, {
                                  showIf: {
                                    field_key: field.showIf!.field_key,
                                    op: value as NonNullable<
                                      typeof field.showIf
                                    >["op"],
                                    ...(field.showIf!.value === undefined
                                      ? {}
                                      : { value: field.showIf!.value }),
                                  },
                                })
                              }
                            >
                              <SelectTrigger
                                aria-label={t("editor.conditionOperator")}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(["is_set", "eq", "neq", "in"] as const).map(
                                  (op) => (
                                    <SelectItem key={op} value={op}>
                                      {t(`editor.conditionOperators.${op}`)}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectContent>
                            </Select>
                            {field.showIf.op !== "is_set" ? (
                              field.showIf.op === "in" ? (
                                <Textarea
                                  aria-label={t("editor.conditionValue")}
                                  value={
                                    Array.isArray(field.showIf.value)
                                      ? field.showIf.value.join("\n")
                                      : ""
                                  }
                                  onChange={(event) =>
                                    updateField(index, {
                                      showIf: {
                                        field_key: field.showIf!.field_key,
                                        op: "in",
                                        value: event.currentTarget.value
                                          .split("\n")
                                          .filter(Boolean),
                                      },
                                    })
                                  }
                                />
                              ) : (
                                <Input
                                  aria-label={t("editor.conditionValue")}
                                  value={
                                    typeof field.showIf.value === "string"
                                      ? field.showIf.value
                                      : ""
                                  }
                                  onChange={(event) =>
                                    updateField(index, {
                                      showIf: {
                                        field_key: field.showIf!.field_key,
                                        op: field.showIf!.op,
                                        value: event.currentTarget.value,
                                      },
                                    })
                                  }
                                />
                              )
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("editor.moveUp")}
                        disabled={index === 0}
                        onClick={() => moveField(index, index - 1)}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("editor.moveDown")}
                        disabled={index === draft.formSchema.fields.length - 1}
                        onClick={() => moveField(index, index + 1)}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("editor.removeField")}
                        disabled={field.mapsTo?.field === "title"}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            formSchema: {
                              fields: current.formSchema.fields
                                .filter((_, fieldIndex) => fieldIndex !== index)
                                .map((remaining) =>
                                  remaining.showIf?.field_key === field.key
                                    ? { ...remaining, showIf: undefined }
                                    : remaining,
                                ),
                            },
                          }))
                        }
                      >
                        ×
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending || !draft.name.trim() || !draft.workItemTypeId
              }
            >
              <Save aria-hidden="true" />
              {save.isPending ? t("editor.saving") : t("editor.save")}
            </Button>
            {!isNew && item ? (
              <Button
                variant="outline"
                disabled={publish.isPending}
                onClick={() => publish.mutate()}
              >
                {item.published ? t("unpublish") : t("editor.publish")}
              </Button>
            ) : null}
            {saved ? (
              <span
                role="status"
                className="self-center text-sm text-muted-foreground"
              >
                {t("editor.saved")}
              </span>
            ) : null}
          </div>
        </section>
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">{t("editor.preview")}</h2>
          <Card>
            <CardContent className="space-y-4 p-6">
              <div>
                <h3 className="font-semibold">
                  {draft.name || t("editor.newTitle")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {draft.description}
                </p>
              </div>
              <RequestTypeFields
                schema={draft.formSchema}
                values={previewValues}
                requiredLabel={t("editor.required")}
                selectPlaceholder={t("editor.fieldType")}
                emptyOptionsLabel={t("editor.noWorkItemTypes")}
                comboTriggerLabel={t("editor.fieldType")}
                onValueChange={(key, value) =>
                  setPreviewValues((current) => ({ ...current, [key]: value }))
                }
                onFilesChange={(key, files) =>
                  setPreviewValues((current) => ({
                    ...current,
                    [key]: files ? Array.from(files, (file) => file.name) : [],
                  }))
                }
              />
            </CardContent>
          </Card>
        </section>
      </main>
    </>
  );
}
