import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  deleteRequestType,
  getRequestType,
  getRequestTypes,
  publishRequestType,
  saveRequestType,
  unpublishRequestType,
} from "@/fetchers/intake";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { isIntakeConditionSatisfied } from "@/lib/intake-visibility";
import { parseRequestTypeEditorSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/request-types",
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
const blank = (): Omit<
  RequestType,
  "id" | "version" | "published" | "key"
> => ({
  name: "",
  description: "",
  group: "General",
  workItemTypeId: "",
  defaultProjectId: null,
  formSchema: {
    fields: [
      {
        key: "title",
        label: "Summary",
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
  const workItemTypes = useGetWorkItemTypes({
    workspaceId: workspace.data?.id,
  });
  const [draft, setDraft] = useState<
    Omit<RequestType, "id" | "version" | "published" | "key">
  >(blank());
  const [dragged, setDragged] = useState<number | null>(null);
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>(
    {},
  );
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
        queryKey: ["request-type", saved.id],
      });
    },
  });
  const action = useMutation({
    mutationFn: async (kind: "publish" | "unpublish" | "delete") => {
      if (!selected) return;
      if (kind === "publish") return publishRequestType(selected);
      if (kind === "unpublish") return unpublishRequestType(selected);
      return deleteRequestType(selected);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["request-types"] });
      if (selected)
        await queryClient.invalidateQueries({
          queryKey: ["request-type", selected],
        });
    },
  });
  const choose = (id: string | null) => {
    setSelected(id);
    if (!id) setDraft(blank());
  };
  const fields = draft.formSchema.fields;
  const updateField = (index: number, patch: Partial<Field>) =>
    setDraft((current) => ({
      ...current,
      formSchema: {
        fields: current.formSchema.fields.map((field, i) =>
          i === index ? { ...field, ...patch } : field,
        ),
      },
    }));
  const reorder = (from: number, to: number) =>
    setDraft((current) => {
      const next = [...current.formSchema.fields];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return { ...current, formSchema: { fields: next } };
    });
  const loading = types.isLoading || workItemTypes.isLoading;
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
    <main className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <PageTitle title={t("title")} />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={() => void choose(null)}>{t("new")}</Button>
      </header>
      {(types.isError ||
        detail.isError ||
        save.isError ||
        action.isError ||
        workItemTypes.isError) && (
        <Alert variant="error">
          <AlertDescription>{t("loadError")}</AlertDescription>
        </Alert>
      )}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(16rem,1fr)_2fr]">
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
                Name
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
                Catalogue group
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
                Description
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
                Work item type
                <Select
                  value={draft.workItemTypeId || null}
                  onValueChange={(value) =>
                    setDraft({ ...draft, workItemTypeId: value ?? "" })
                  }
                >
                  <SelectTrigger id="request-type-work-item-type">
                    <SelectValue placeholder="Choose a type" />
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
                Default project ID
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
                Catalogue order
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
                Visible to customers
              </label>
              <label htmlFor="request-type-auto-accept">
                <Checkbox
                  id="request-type-auto-accept"
                  checked={draft.autoAccept}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, autoAccept: Boolean(checked) })
                  }
                />{" "}
                Auto accept
              </label>
              <label htmlFor="request-type-force-private">
                <Checkbox
                  id="request-type-force-private"
                  checked={draft.forcePrivate}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, forcePrivate: Boolean(checked) })
                  }
                />{" "}
                Keep submissions private
              </label>
            </div>
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Form fields</h3>
              <Button
                variant="outline"
                onClick={() =>
                  setDraft({
                    ...draft,
                    formSchema: {
                      fields: [
                        ...fields,
                        {
                          key: `field_${fields.length + 1}`,
                          label: "New question",
                          type: "text",
                          required: false,
                        },
                      ],
                    },
                  })
                }
              >
                Add field
              </Button>
            </div>
            {fields.map((field, index) => (
              <article
                key={field.key}
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
                  Field key
                  <Input
                    id={`field-key-${index}`}
                    value={field.key}
                    onChange={(e) =>
                      updateField(index, { key: e.target.value })
                    }
                  />
                </label>
                <label htmlFor={`field-label-${index}`}>
                  Customer label
                  <Input
                    id={`field-label-${index}`}
                    value={field.label}
                    onChange={(e) =>
                      updateField(index, { label: e.target.value })
                    }
                  />
                </label>
                <label htmlFor={`field-type-${index}`}>
                  Type
                  <Select
                    value={field.type}
                    onValueChange={(value) =>
                      value &&
                      updateField(index, { type: value as Field["type"] })
                    }
                  >
                    <SelectTrigger id={`field-type-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="textarea">Long text</SelectItem>
                      <SelectItem value="select">Select</SelectItem>
                      <SelectItem value="checkbox">Checkbox</SelectItem>
                      <SelectItem value="file">File</SelectItem>
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
                  Required
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
                      ? "Required file uploads are not publishable until the submission file contract is defined; clear Required to publish."
                      : "Required is unavailable for file uploads until the submission file contract is defined."}
                  </p>
                )}
                <label
                  className="sm:col-span-2"
                  htmlFor={`field-help-${index}`}
                >
                  Help text
                  <Input
                    id={`field-help-${index}`}
                    value={field.help ?? ""}
                    onChange={(e) =>
                      updateField(index, { help: e.target.value || undefined })
                    }
                  />
                </label>
                <label
                  className="sm:col-span-2"
                  htmlFor={`field-options-${index}`}
                >
                  Options (one per line)
                  <Textarea
                    id={`field-options-${index}`}
                    value={(field.options ?? []).join("\n")}
                    onChange={(e) =>
                      updateField(index, {
                        options: e.target.value.split("\n").filter(Boolean),
                      })
                    }
                    disabled={field.type !== "select"}
                  />
                </label>
                <label htmlFor={`field-maps-to-${index}`}>
                  Maps to
                  <Select
                    value={field.mapsTo?.field ?? null}
                    onValueChange={(value) =>
                      updateField(index, {
                        mapsTo: value ? { field: value } : undefined,
                      })
                    }
                  >
                    <SelectTrigger id={`field-maps-to-${index}`}>
                      <SelectValue placeholder="Keep in request data" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="title">Work item title</SelectItem>
                      <SelectItem value="description">
                        Work item description
                      </SelectItem>
                      <SelectItem value="priority">
                        Work item priority
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                {field.type === "select" &&
                  field.mapsTo?.field === "priority" && (
                    <fieldset className="flex flex-col gap-2 sm:col-span-2">
                      <legend className="font-medium">
                        Priority value mapping
                      </legend>
                      {field.options?.map((option) => (
                        <label
                          key={option}
                          className="grid gap-2 sm:grid-cols-2"
                          htmlFor={`field-map-${index}-${option}`}
                        >
                          <span>{option}</span>
                          <Select
                            value={
                              field.mapsTo?.map?.[option] ??
                              (["low", "medium", "high", "urgent"].includes(
                                option,
                              )
                                ? option
                                : null)
                            }
                            onValueChange={(value) => {
                              const map = { ...(field.mapsTo?.map ?? {}) };
                              if (value) map[option] = value;
                              else delete map[option];
                              updateField(index, {
                                mapsTo: { field: "priority", map },
                              });
                            }}
                          >
                            <SelectTrigger id={`field-map-${index}-${option}`}>
                              <SelectValue placeholder="Choose priority" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectContent>
                          </Select>
                        </label>
                      ))}
                    </fieldset>
                  )}
                <label htmlFor={`field-show-when-${index}`}>
                  Show when
                  <Select
                    value={field.showIf?.field_key ?? null}
                    onValueChange={(value) =>
                      updateField(index, {
                        showIf: value
                          ? { field_key: value, op: "eq", value: "" }
                          : undefined,
                      })
                    }
                  >
                    <SelectTrigger id={`field-show-when-${index}`}>
                      <SelectValue placeholder="Always visible" />
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
                {field.showIf && (
                  <label htmlFor={`field-show-value-${index}`}>
                    Equals value
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
                    Allow multiple files
                  </label>
                )}
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    aria-label={`Move ${field.label} up`}
                    disabled={index === 0}
                    onClick={() => reorder(index, index - 1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="outline"
                    aria-label={`Move ${field.label} down`}
                    disabled={index === fields.length - 1}
                    onClick={() => reorder(index, index + 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        formSchema: {
                          fields: fields.filter((_, i) => i !== index),
                        },
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </article>
            ))}
            <section className="rounded-md bg-muted p-4">
              <h3 className="font-medium">Customer preview</h3>
              <p className="text-sm text-muted-foreground">
                {draft.description || "Request form description"}
              </p>
              <div className="mt-3 grid gap-3">
                {fields
                  .filter((field) => {
                    if (!field.showIf) return true;
                    const actual = previewValues[field.showIf.field_key];
                    return isIntakeConditionSatisfied(field.showIf, actual);
                  })
                  .map((field) => (
                    <div key={field.key} className="flex flex-col gap-1">
                      {field.label}
                      {field.required ? " *" : ""}
                      {field.type === "textarea" ? (
                        <Textarea
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
                          <SelectTrigger>
                            <SelectValue placeholder="Choose…" />
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
                        <Input type="file" multiple={field.multiple} />
                      ) : field.type === "checkbox" ? (
                        <Checkbox
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
                ? "Exactly one required text field maps to the work item title."
                : "Publishing requires exactly one required text field mapped to the work item title."}
            </p>
            {!priorityMappingValid && (
              <p className="text-sm text-destructive" role="alert">
                Every priority option must map to low, medium, high, or urgent
                before publishing.
              </p>
            )}
            {!requiredFileValid && (
              <p className="text-sm text-destructive" role="alert">
                Required file uploads are not publishable until the submission
                file contract is defined; clear Required to publish.
              </p>
            )}
            {selectedType?.key && (
              <p className="text-xs text-muted-foreground">
                Opaque catalogue key: {selectedType.key}
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
              {selected && !selectedType?.published && (
                <Button
                  variant="destructive"
                  onClick={() => action.mutate("delete")}
                >
                  {t("delete")}
                </Button>
              )}
            </div>
            {(
              detail.data as unknown as
                | { versions?: Array<{ number: number; createdAt: string }> }
                | undefined
            )?.versions?.length ? (
              <section>
                <h3 className="font-medium">Published versions</h3>
                <ol className="text-sm">
                  {(
                    detail.data as unknown as {
                      versions: Array<{ number: number; createdAt: string }>;
                    }
                  ).versions.map((version) => (
                    <li key={version.number}>
                      Version {version.number} ·{" "}
                      {new Date(version.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </section>
        </div>
      )}
    </main>
  );
}
