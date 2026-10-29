import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { ArrowLeft, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CustomFieldValueInput } from "@/components/custom-field/custom-field-value-input";
import PageTitle from "@/components/page-title";
import {
  type CustomField,
  type CustomFieldInput,
  createCustomField,
  requestCustomFieldDeletion,
  updateCustomField,
} from "@/fetchers/custom-field";
import {
  useCustomFieldSections,
  useCustomFields,
} from "@/hooks/queries/custom-field/use-custom-fields";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  assignOptionKeys,
  CUSTOM_FIELD_FORMATS,
  type CustomFieldFormat,
  type OptionDraft,
  slugifyFieldKey,
  type VisibilityOp,
} from "@/lib/custom-field";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";

type Access = "hidden" | "visible" | "required";
const ACCESS: Access[] = ["hidden", "visible", "required"];
const OPS: VisibilityOp[] = ["eq", "neq", "in", "is_set"];

type Draft = {
  name: string;
  key: string;
  keyTouched: boolean;
  format: CustomFieldFormat;
  sectionId: string;
  helpText: string;
  customerVisible: boolean;
  options: OptionDraft[];
  defaultValue: unknown;
  condition: { fieldKey: string; op: VisibilityOp; value: unknown } | null;
  access: Record<string, Access>;
};

function draftFrom(field: CustomField | undefined, sectionId: string): Draft {
  return {
    name: field?.name ?? "",
    key: field?.key ?? "",
    keyTouched: Boolean(field),
    format: field?.format ?? "text",
    sectionId: field?.sectionId ?? sectionId,
    helpText: field?.helpText ?? "",
    customerVisible: field?.customerVisible ?? false,
    options: (field?.options ?? []).map((option) => ({
      key: option.key,
      label: option.label,
    })),
    defaultValue: field?.defaultValue ?? null,
    condition: field?.visibilityCondition
      ? {
          fieldKey: field.visibilityCondition.field_key,
          op: field.visibilityCondition.op,
          value: field.visibilityCondition.value ?? null,
        }
      : null,
    access: Object.fromEntries(
      (field?.visibility ?? []).map((row) => [
        row.workItemTypeId,
        row.required ? "required" : row.visible ? "visible" : "hidden",
      ]),
    ),
  };
}

const hasOptions = (format: CustomFieldFormat) =>
  format === "select" || format === "multi_select";

function EditorForm({
  field,
  isNew,
  workspaceId,
  sections,
  others,
  types,
  canManage,
}: {
  field: CustomField | undefined;
  isNew: boolean;
  workspaceId: string;
  sections: { id: string; name: string }[];
  others: CustomField[];
  types: { id: string; name: string }[];
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const openPendingAction = useOpenPendingAction();
  const [draft, setDraft] = useState(() =>
    draftFrom(field, sections[0]?.id ?? ""),
  );
  const patch = (next: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...next }));
  const effectiveOptions = hasOptions(draft.format)
    ? assignOptionKeys(draft.options.filter((o) => o.label.trim()))
    : [];
  const controllers = others.filter(
    (other) =>
      other.id !== field?.id &&
      other.deletedAt === null &&
      other.visibilityCondition === null,
  );
  const controller = controllers.find(
    (other) => other.key === draft.condition?.fieldKey,
  );

  const buildInput = (): CustomFieldInput => {
    const options = effectiveOptions;
    return {
      sectionId: draft.sectionId,
      key: draft.key,
      name: draft.name.trim(),
      format: draft.format,
      options,
      defaultValue: draft.defaultValue ?? null,
      helpText: draft.helpText.trim() || null,
      customerVisible: draft.customerVisible,
      visibilityCondition: draft.condition
        ? {
            field_key: draft.condition.fieldKey,
            op: draft.condition.op,
            ...(draft.condition.op === "is_set"
              ? {}
              : { value: draft.condition.value }),
          }
        : null,
      visibility: Object.entries(draft.access)
        .filter(([, access]) => access !== "hidden")
        .map(([workItemTypeId, access]) => ({
          workItemTypeId,
          visible: true,
          required: access === "required",
        })),
    };
  };

  const save = useMutation({
    mutationFn: async () => {
      const input = buildInput();
      if (isNew) return createCustomField(workspaceId, input);
      const { key: _key, visibility, ...update } = input;
      return updateCustomField(field?.id ?? "", update, visibility);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["custom-fields"] });
      toast.success(t("customFields:editor.saved"));
      if (isNew)
        void navigate({
          to: routes.workspaceCustomFieldEditor.path,
          params: { id: saved.id },
          replace: true,
        });
    },
  });
  const requestDeletion = useMutation({
    mutationFn: () => requestCustomFieldDeletion(field?.id ?? ""),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(error.message),
  });

  const conditionComplete =
    draft.condition === null ||
    (Boolean(draft.condition.fieldKey) &&
      (draft.condition.op === "is_set" ||
        (draft.condition.value !== null &&
          draft.condition.value !== undefined &&
          draft.condition.value !== "")));
  const valid =
    draft.name.trim().length > 0 &&
    /^[a-z][a-z0-9_]{0,63}$/.test(draft.key) &&
    Boolean(draft.sectionId) &&
    (!hasOptions(draft.format) || effectiveOptions.length > 0) &&
    conditionComplete;
  const disabled = !canManage || save.isPending;

  return (
    <form
      id="custom-field-form"
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !disabled) save.mutate();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("customFields:editor.detailsTitle")}</CardTitle>
          <CardDescription>
            {t("customFields:editor.detailsDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cf-name">{t("customFields:fields.name")}</Label>
              <Input
                id="cf-name"
                required
                maxLength={120}
                value={draft.name}
                disabled={disabled}
                onChange={(event) =>
                  patch({
                    name: event.target.value,
                    ...(draft.keyTouched
                      ? {}
                      : { key: slugifyFieldKey(event.target.value) }),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cf-key">{t("customFields:fields.key")}</Label>
              <Input
                id="cf-key"
                required
                maxLength={64}
                value={draft.key}
                disabled={disabled || !isNew}
                onChange={(event) =>
                  patch({ key: event.target.value, keyTouched: true })
                }
              />
              <p className="text-muted-foreground text-xs">
                {isNew
                  ? t("customFields:fields.keyHelp")
                  : t("customFields:fields.keyLocked")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cf-format">
                {t("customFields:fields.format")}
              </Label>
              <Select
                value={draft.format}
                disabled={disabled || !isNew}
                onValueChange={(value) => {
                  if (value)
                    patch({
                      format: value as CustomFieldFormat,
                      options: [],
                      defaultValue: null,
                      condition: draft.condition,
                    });
                }}
              >
                <SelectTrigger id="cf-format">
                  <SelectValue>
                    {t(`customFields:formats.${draft.format}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_FORMATS.map((format) => (
                    <SelectItem key={format} value={format}>
                      {t(`customFields:formats.${format}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!isNew ? (
                <p className="text-muted-foreground text-xs">
                  {t("customFields:fields.formatLocked")}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cf-section">
                {t("customFields:fields.section")}
              </Label>
              <Select
                value={draft.sectionId || null}
                disabled={disabled}
                onValueChange={(value) => {
                  if (value) patch({ sectionId: value });
                }}
              >
                <SelectTrigger id="cf-section">
                  <SelectValue>
                    {sections.find((section) => section.id === draft.sectionId)
                      ?.name ?? t("customFields:fields.sectionPlaceholder")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cf-help">{t("customFields:fields.help")}</Label>
            <Input
              id="cf-help"
              maxLength={500}
              value={draft.helpText}
              disabled={disabled}
              onChange={(event) => patch({ helpText: event.target.value })}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="cf-customer">
                {t("customFields:fields.customerVisible")}
              </Label>
              <p className="max-w-md text-muted-foreground text-xs">
                {t("customFields:fields.customerVisibleHelp")}
              </p>
            </div>
            <Switch
              id="cf-customer"
              checked={draft.customerVisible}
              disabled={disabled}
              onCheckedChange={(checked) => patch({ customerVisible: checked })}
            />
          </div>
        </CardContent>
      </Card>

      {hasOptions(draft.format) ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("customFields:editor.optionsTitle")}</CardTitle>
            <CardDescription>
              {t("customFields:editor.optionsDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {draft.options.map((option, index) => (
              <div
                key={option.key ?? `new-${index}`}
                className="flex items-center gap-2"
              >
                <Input
                  aria-label={t("customFields:editor.optionLabel", {
                    index: index + 1,
                  })}
                  maxLength={120}
                  value={option.label}
                  disabled={disabled}
                  onChange={(event) =>
                    patch({
                      options: draft.options.map((current, i) =>
                        i === index
                          ? { ...current, label: event.target.value }
                          : current,
                      ),
                    })
                  }
                />
                {option.key ? (
                  <Badge variant="outline" className="shrink-0">
                    {option.key}
                  </Badge>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={t("customFields:editor.removeOption", {
                    index: index + 1,
                  })}
                  onClick={() =>
                    patch({
                      options: draft.options.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                patch({ options: [...draft.options, { key: null, label: "" }] })
              }
            >
              <Plus aria-hidden="true" />
              {t("customFields:editor.addOption")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle
            render={
              <Label
                htmlFor="cf-default"
                className="text-lg leading-none sm:text-lg sm:leading-none"
              />
            }
          >
            {t("customFields:editor.defaultTitle")}
          </CardTitle>
          <CardDescription>
            {t("customFields:editor.defaultDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomFieldValueInput
            id="cf-default"
            field={{
              name: t("customFields:editor.defaultTitle"),
              format: draft.format,
              options: effectiveOptions,
            }}
            value={draft.defaultValue}
            disabled={disabled}
            onChange={(value) => patch({ defaultValue: value })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("customFields:editor.visibilityTitle")}</CardTitle>
          <CardDescription>
            {t("customFields:editor.visibilityDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {types.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("customFields:editor.noTypes")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("customFields:editor.typeColumn")}</TableHead>
                  <TableHead className="w-48">
                    {t("customFields:editor.accessColumn")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((type) => {
                  const access = draft.access[type.id] ?? "hidden";
                  return (
                    <TableRow key={type.id}>
                      <TableCell className="font-medium">{type.name}</TableCell>
                      <TableCell>
                        <Select
                          value={access}
                          disabled={disabled}
                          onValueChange={(value) => {
                            if (value)
                              patch({
                                access: {
                                  ...draft.access,
                                  [type.id]: value as Access,
                                },
                              });
                          }}
                        >
                          <SelectTrigger
                            aria-label={t("customFields:editor.accessFor", {
                              name: type.name,
                            })}
                          >
                            <SelectValue>
                              {t(`customFields:access.${access}`)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {ACCESS.map((value) => (
                              <SelectItem key={value} value={value}>
                                {t(`customFields:access.${value}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("customFields:editor.conditionTitle")}</CardTitle>
          <CardDescription>
            {t("customFields:editor.conditionDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="cf-conditional"
              checked={draft.condition !== null}
              disabled={disabled || controllers.length === 0}
              onCheckedChange={(checked) =>
                patch({
                  condition: checked
                    ? {
                        fieldKey: controllers[0]?.key ?? "",
                        op: "is_set",
                        value: null,
                      }
                    : null,
                })
              }
            />
            <Label htmlFor="cf-conditional" className="font-normal text-sm">
              {controllers.length === 0
                ? t("customFields:editor.noControllers")
                : t("customFields:editor.conditionToggle")}
            </Label>
          </div>
          {draft.condition ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="cf-controller">
                  {t("customFields:editor.controller")}
                </Label>
                <Select
                  value={draft.condition.fieldKey || null}
                  disabled={disabled}
                  onValueChange={(value) => {
                    if (value && draft.condition)
                      patch({
                        condition: {
                          fieldKey: value,
                          op: "is_set",
                          value: null,
                        },
                      });
                  }}
                >
                  <SelectTrigger id="cf-controller">
                    <SelectValue>
                      {controller?.name ??
                        t("customFields:editor.controllerPlaceholder")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {controllers.map((other) => (
                      <SelectItem key={other.id} value={other.key}>
                        {other.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cf-op">
                  {t("customFields:editor.operator")}
                </Label>
                <Select
                  value={draft.condition.op}
                  disabled={disabled}
                  onValueChange={(value) => {
                    if (value && draft.condition)
                      patch({
                        condition: {
                          ...draft.condition,
                          op: value as VisibilityOp,
                          value: value === "in" ? [] : null,
                        },
                      });
                  }}
                >
                  <SelectTrigger id="cf-op">
                    <SelectValue>
                      {t(`customFields:operators.${draft.condition.op}`)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {OPS.filter(
                      (op) =>
                        op !== "in" ||
                        controller?.format === "select" ||
                        controller?.format === "multi_select",
                    ).map((op) => (
                      <SelectItem key={op} value={op}>
                        {t(`customFields:operators.${op}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {draft.condition.op !== "is_set" && controller ? (
                <div className="space-y-2">
                  <Label htmlFor="cf-condition-value">
                    {t("customFields:editor.value")}
                  </Label>
                  <CustomFieldValueInput
                    id="cf-condition-value"
                    field={{
                      name: controller.name,
                      format:
                        draft.condition.op === "in"
                          ? "multi_select"
                          : controller.format,
                      options: controller.options,
                    }}
                    value={draft.condition.value}
                    disabled={disabled}
                    onChange={(value) =>
                      patch({
                        condition: draft.condition
                          ? { ...draft.condition, value }
                          : null,
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {save.error ? (
        <Alert variant="error" role="alert">
          <AlertTitle>{t("customFields:editor.saveFailed")}</AlertTitle>
          <AlertDescription>{save.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <Button type="submit" disabled={disabled || !valid}>
            {save.isPending
              ? t("customFields:editor.saving")
              : isNew
                ? t("customFields:editor.create")
                : t("customFields:editor.save")}
          </Button>
        ) : null}
        {!isNew && canManage ? (
          <Button
            type="button"
            variant="destructive"
            disabled={requestDeletion.isPending}
            onClick={() => requestDeletion.mutate()}
          >
            {t("customFields:editor.delete")}
          </Button>
        ) : null}
      </div>
      {!isNew && canManage ? (
        <p className="text-muted-foreground text-xs">
          {t("customFields:editor.deleteHelp", {
            count: field?.usageCount ?? 0,
          })}
        </p>
      ) : null}
    </form>
  );
}

/** `docs/screens.md` "Custom field editor". */
export function CustomFieldEditor({ fieldId }: { fieldId: string }) {
  const { t } = useTranslation();
  const isNew = fieldId === "new";
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const fields = useCustomFields(workspaceId);
  const sections = useCustomFieldSections(workspaceId);
  const types = useGetWorkItemTypes({ workspaceId });
  const { canManageCustomFields, isCheckingPermissions } =
    useWorkspacePermission();
  const canManage = canManageCustomFields() && !isCheckingPermissions;
  const field = fields.data?.data.find((row) => row.id === fieldId);
  const loading =
    workspaceLoading ||
    fields.isLoading ||
    sections.isLoading ||
    types.isLoading;
  const failed = fields.isError || sections.isError || types.isError;
  const missing = !loading && !failed && !isNew && !field;
  const title = isNew
    ? t("customFields:editor.newTitle")
    : (field?.name ?? t("customFields:editor.pageTitle"));

  return (
    <>
      <PageTitle title={title} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="space-y-2">
          <Button
            render={<Link to={routes.workspaceCustomFields.path} />}
            variant="ghost"
            size="sm"
          >
            <ArrowLeft aria-hidden="true" />
            {t("customFields:editor.allFields")}
          </Button>
          <h1 className="text-2xl font-semibold">{title}</h1>
        </div>
        {!canManage && !isCheckingPermissions ? (
          <Alert variant="info">
            <AlertTitle>{t("customFields:editor.readOnlyTitle")}</AlertTitle>
            <AlertDescription>
              {t("customFields:editor.readOnlyDescription")}
            </AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <div role="status" aria-label={t("customFields:editor.loading")}>
            <Skeleton className="h-72 w-full" />
          </div>
        ) : failed ? (
          <Alert variant="error">
            <AlertTitle>{t("customFields:editor.loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              {t("customFields:editor.loadErrorDescription")}
              <Button
                className="w-fit"
                onClick={() => {
                  void fields.refetch();
                  void sections.refetch();
                  void types.refetch();
                }}
              >
                <RefreshCw aria-hidden="true" />
                {t("common:actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : missing ? (
          <Alert variant="error">
            <AlertTitle>{t("customFields:editor.notFoundTitle")}</AlertTitle>
            <AlertDescription>
              {t("customFields:editor.notFoundDescription")}
            </AlertDescription>
          </Alert>
        ) : (
          <EditorForm
            key={field ? `${field.id}:${field.updatedAt}` : "new"}
            field={field}
            isNew={isNew}
            workspaceId={workspaceId}
            sections={sections.data ?? []}
            others={fields.data?.data ?? []}
            types={(types.data ?? []).map((type) => ({
              id: type.id,
              name: type.name,
            }))}
            canManage={canManage}
          />
        )}
      </div>
    </>
  );
}
