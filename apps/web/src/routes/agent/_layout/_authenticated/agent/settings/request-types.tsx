import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
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

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/request-types",
)({ component: RequestTypesPage });

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
  const types = useQuery({
    queryKey: ["request-types", workspace.data?.id],
    queryFn: () => getRequestTypes(workspace.data?.id ?? ""),
    enabled: Boolean(workspace.data?.id),
  });
  const workItemTypes = useGetWorkItemTypes({
    workspaceId: workspace.data?.id,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<
    Omit<RequestType, "id" | "version" | "published" | "key">
  >(blank());
  const [dragged, setDragged] = useState<number | null>(null);
  const detail = useQuery({
    queryKey: ["request-type", selected],
    queryFn: () => getRequestType(selected ?? ""),
    enabled: Boolean(selected),
  });
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
  const choose = async (id: string | null) => {
    setSelected(id);
    if (!id) {
      setDraft(blank());
      return;
    }
    const response = (await getRequestType(id)) as unknown as RequestType;
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
                <select
                  id="request-type-work-item-type"
                  className="h-10 rounded border bg-background px-3"
                  value={draft.workItemTypeId}
                  onChange={(e) =>
                    setDraft({ ...draft, workItemTypeId: e.target.value })
                  }
                >
                  <option value="">Choose a type</option>
                  {workItemTypes.data?.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
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
              <label>
                <input
                  type="checkbox"
                  checked={draft.customerVisible}
                  onChange={(e) =>
                    setDraft({ ...draft, customerVisible: e.target.checked })
                  }
                />{" "}
                Visible to customers
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.autoAccept}
                  onChange={(e) =>
                    setDraft({ ...draft, autoAccept: e.target.checked })
                  }
                />{" "}
                Auto accept
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.forcePrivate}
                  onChange={(e) =>
                    setDraft({ ...draft, forcePrivate: e.target.checked })
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
                  <select
                    id={`field-type-${index}`}
                    className="h-10 rounded border bg-background px-3"
                    value={field.type}
                    onChange={(e) =>
                      updateField(index, {
                        type: e.target.value as Field["type"],
                      })
                    }
                  >
                    <option value="text">Text</option>
                    <option value="textarea">Long text</option>
                    <option value="select">Select</option>
                    <option value="checkbox">Checkbox</option>
                    <option value="file">File</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) =>
                      updateField(index, { required: e.target.checked })
                    }
                  />{" "}
                  Required
                </label>
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
                  <select
                    id={`field-maps-to-${index}`}
                    className="h-10 rounded border bg-background px-3"
                    value={field.mapsTo?.field ?? ""}
                    onChange={(e) =>
                      updateField(index, {
                        mapsTo: e.target.value
                          ? { field: e.target.value }
                          : undefined,
                      })
                    }
                  >
                    <option value="">Keep in request data</option>
                    <option value="title">Work item title</option>
                    <option value="description">Work item description</option>
                    <option value="priority">Work item priority</option>
                  </select>
                </label>
                <label htmlFor={`field-show-when-${index}`}>
                  Show when
                  <select
                    id={`field-show-when-${index}`}
                    className="h-10 rounded border bg-background px-3"
                    value={field.showIf?.field_key ?? ""}
                    onChange={(e) =>
                      updateField(index, {
                        showIf: e.target.value
                          ? { field_key: e.target.value, op: "eq", value: "" }
                          : undefined,
                      })
                    }
                  >
                    <option value="">Always visible</option>
                    {fields
                      .filter((candidate) => candidate.key !== field.key)
                      .map((candidate) => (
                        <option key={candidate.key} value={candidate.key}>
                          {candidate.label}
                        </option>
                      ))}
                  </select>
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
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={field.multiple ?? false}
                      onChange={(e) =>
                        updateField(index, { multiple: e.target.checked })
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
                {fields.map((field) => (
                  <div key={field.key} className="flex flex-col gap-1">
                    {field.label}
                    {field.required ? " *" : ""}
                    {field.type === "textarea" ? (
                      <Textarea disabled placeholder={field.help} />
                    ) : field.type === "select" ? (
                      <select
                        disabled
                        className="h-10 rounded border bg-background px-3"
                      >
                        <option>Choose…</option>
                        {field.options?.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        disabled
                        type={field.type === "checkbox" ? "checkbox" : "text"}
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
                  disabled={!titleMappingValid || action.isPending}
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
