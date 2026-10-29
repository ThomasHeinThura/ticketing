import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFrame,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  type CustomField,
  type CustomFieldSection,
  createCustomFieldSection,
  deleteCustomFieldSection,
  renameCustomFieldSection,
  reorderCustomFieldSections,
  reorderCustomFields,
  restoreCustomField,
} from "@/fetchers/custom-field";
import {
  customFieldSectionsKey,
  useCustomFieldSections,
  useCustomFields,
} from "@/hooks/queries/custom-field/use-custom-fields";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(to, 0, item);
  return next;
}

function SectionDialog({
  section,
  workspaceId,
  onClose,
  finalFocus,
}: {
  section?: CustomFieldSection;
  workspaceId: string;
  onClose: () => void;
  finalFocus: () => HTMLElement | false;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(section?.name ?? "");
  const save = useMutation({
    mutationFn: () =>
      section
        ? renameCustomFieldSection(section.id, name.trim())
        : createCustomFieldSection(workspaceId, name.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: customFieldSectionsKey(workspaceId),
      });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        closeLabel={t("common:actions.close")}
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>
            {section
              ? t("customFields:sections.rename")
              : t("customFields:sections.create")}
          </DialogTitle>
          <DialogDescription>
            {t("customFields:sections.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !save.isPending) save.mutate();
          }}
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="custom-field-section-name">
                {t("customFields:sections.name")}
              </Label>
              <Input
                id="custom-field-section-name"
                autoFocus
                required
                maxLength={120}
                value={name}
                disabled={save.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {save.error ? (
              <Alert variant="error">
                <AlertDescription>{save.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {t("customFields:editor.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({
  field,
  canManage,
  first,
  last,
  onMove,
  onRestore,
  restoring,
}: {
  field: CustomField;
  canManage: boolean;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  onRestore: () => void;
  restoring: boolean;
}) {
  const { t } = useTranslation();
  const deleted = field.deletedAt !== null;
  const typeCount = field.visibility.filter((row) => row.visible).length;
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-t px-6 py-3 first:border-t-0"
      data-testid={`custom-field-row-${field.key}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {deleted ? (
            <span className="truncate font-medium text-muted-foreground line-through">
              {field.name}
            </span>
          ) : (
            <Link
              className="truncate rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={routes.workspaceCustomFieldEditor.path}
              params={{ id: field.id }}
            >
              {field.name}
            </Link>
          )}
          <Badge variant="outline">
            {t(`customFields:formats.${field.format}`)}
          </Badge>
          {field.customerVisible ? (
            <Badge variant="info">{t("customFields:badges.customer")}</Badge>
          ) : null}
          {deleted ? (
            <Badge variant="warning">{t("customFields:badges.deleted")}</Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {t("customFields:list.fieldMeta", {
            key: field.key,
            types: typeCount,
            used: field.usageCount,
          })}
        </p>
      </div>
      {canManage ? (
        <div className="flex items-center gap-1">
          {deleted ? (
            <Button
              variant="outline"
              size="sm"
              disabled={restoring}
              onClick={onRestore}
            >
              <RotateCcw aria-hidden="true" />
              {t("customFields:list.restore")}
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                disabled={first}
                aria-label={t("customFields:list.moveUp", {
                  name: field.name,
                })}
                onClick={() => onMove(-1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={last}
                aria-label={t("customFields:list.moveDown", {
                  name: field.name,
                })}
                onClick={() => onMove(1)}
              >
                <ArrowDown />
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * `docs/screens.md` "Workspace — custom fields (incl. sections)": fields grouped by section with
 * format, how many types use each, and a usage count; sections can be added, renamed, removed
 * and reordered, and fields reordered within a section.
 */
export function CustomFieldsList({ showDeleted }: { showDeleted: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const fields = useCustomFields(workspaceId, showDeleted);
  const sections = useCustomFieldSections(workspaceId);
  const { canManageCustomFields, isCheckingPermissions } =
    useWorkspacePermission();
  const canManage = canManageCustomFields() && !isCheckingPermissions;
  const [sectionDialog, setSectionDialog] = useState<
    "new" | CustomFieldSection | null
  >(null);
  const sectionDialogTrigger = useRef<HTMLButtonElement | null>(null);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["custom-fields"] }),
      queryClient.invalidateQueries({ queryKey: ["custom-field-sections"] }),
    ]);
  };
  const reorderFields = useMutation({
    mutationFn: (layout: { sectionId: string; fieldIds: string[] }[]) =>
      reorderCustomFields(workspaceId, layout),
    onSettled: refresh,
    onError: (error) => toast.error(error.message),
  });
  const reorderSections = useMutation({
    mutationFn: (ids: string[]) => reorderCustomFieldSections(workspaceId, ids),
    onSettled: refresh,
    onError: (error) => toast.error(error.message),
  });
  const removeSection = useMutation({
    mutationFn: (id: string) => deleteCustomFieldSection(id),
    onSettled: refresh,
    onError: (error) => toast.error(error.message),
  });
  const restore = useMutation({
    mutationFn: (id: string) => restoreCustomField(id),
    onSettled: refresh,
    onError: (error) => toast.error(error.message),
  });

  const loading = workspaceLoading || fields.isLoading || sections.isLoading;
  const allFields = fields.data?.data ?? [];
  const active = allFields.filter((field) => field.deletedAt === null);
  const orderedSections = sections.data ?? [];
  const fieldsIn = (sectionId: string, includeDeleted: boolean) =>
    allFields.filter(
      (field) =>
        field.sectionId === sectionId &&
        (includeDeleted || field.deletedAt === null),
    );
  const layoutWith = (sectionId: string, fieldIds: string[]) =>
    orderedSections.map((section) => ({
      sectionId: section.id,
      fieldIds:
        section.id === sectionId
          ? fieldIds
          : fieldsIn(section.id, false).map((field) => field.id),
    }));

  return (
    <>
      <PageTitle title={t("customFields:list.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">
              {t("customFields:list.title")}
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("customFields:list.description")}
            </p>
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!workspace}
                onClick={(event) => {
                  sectionDialogTrigger.current = event.currentTarget;
                  setSectionDialog("new");
                }}
              >
                <Plus aria-hidden="true" />
                {t("customFields:sections.create")}
              </Button>
              <Button
                disabled={!workspace || orderedSections.length === 0}
                render={
                  <Link
                    to={routes.workspaceCustomFieldEditor.path}
                    params={{ id: "new" }}
                  />
                }
              >
                <Plus aria-hidden="true" />
                {t("customFields:list.new")}
              </Button>
            </div>
          ) : null}
        </div>

        {fields.data?.meta.manyFieldsWarning ? (
          <Alert variant="warning">
            <AlertTitle>{t("customFields:list.manyTitle")}</AlertTitle>
            <AlertDescription>
              {t("customFields:list.manyDescription")}
            </AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div
            role="status"
            aria-label={t("customFields:list.loading")}
            className="space-y-3"
          >
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : fields.isError || sections.isError ? (
          <Alert variant="error">
            <AlertTitle>{t("customFields:list.loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              {t("customFields:list.loadErrorDescription")}
              <Button className="w-fit" onClick={() => void refresh()}>
                <RefreshCw aria-hidden="true" />
                {t("common:actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : orderedSections.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("customFields:list.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("customFields:list.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <CardFrame>
            {orderedSections.map((section, sectionIndex) => {
              const rows = fieldsIn(section.id, showDeleted);
              const activeRows = fieldsIn(section.id, false);
              return (
                <Card key={section.id}>
                  <CardHeader className="has-data-[slot=card-action]:grid-cols-1 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
                    <CardTitle className="min-w-0 break-words">
                      {section.name}
                    </CardTitle>
                    <CardDescription>
                      {t("customFields:list.sectionCount", {
                        count: activeRows.length,
                      })}
                    </CardDescription>
                    {canManage ? (
                      <CardAction className="col-start-1 row-span-1 row-start-3 flex items-center justify-self-start gap-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={sectionIndex === 0}
                          aria-label={t("customFields:sections.moveUp", {
                            name: section.name,
                          })}
                          onClick={() =>
                            reorderSections.mutate(
                              moved(
                                orderedSections.map((s) => s.id),
                                sectionIndex,
                                sectionIndex - 1,
                              ),
                            )
                          }
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={sectionIndex === orderedSections.length - 1}
                          aria-label={t("customFields:sections.moveDown", {
                            name: section.name,
                          })}
                          onClick={() =>
                            reorderSections.mutate(
                              moved(
                                orderedSections.map((s) => s.id),
                                sectionIndex,
                                sectionIndex + 1,
                              ),
                            )
                          }
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("customFields:sections.renameNamed", {
                            name: section.name,
                          })}
                          onClick={(event) => {
                            sectionDialogTrigger.current = event.currentTarget;
                            setSectionDialog(section);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={rows.length > 0 || removeSection.isPending}
                          aria-label={t("customFields:sections.deleteNamed", {
                            name: section.name,
                          })}
                          onClick={() => removeSection.mutate(section.id)}
                        >
                          <Trash2 />
                        </Button>
                      </CardAction>
                    ) : null}
                  </CardHeader>
                  <CardContent className="p-0">
                    {rows.length === 0 ? (
                      <p className="px-6 pb-4 text-muted-foreground text-sm">
                        {t("customFields:list.sectionEmpty")}
                      </p>
                    ) : (
                      rows.map((field) => {
                        const index = activeRows.findIndex(
                          (row) => row.id === field.id,
                        );
                        return (
                          <FieldRow
                            key={field.id}
                            field={field}
                            canManage={canManage}
                            first={index <= 0}
                            last={index === activeRows.length - 1}
                            restoring={restore.isPending}
                            onRestore={() => restore.mutate(field.id)}
                            onMove={(direction) =>
                              reorderFields.mutate(
                                layoutWith(
                                  section.id,
                                  moved(
                                    activeRows.map((row) => row.id),
                                    index,
                                    index + direction,
                                  ),
                                ),
                              )
                            }
                          />
                        );
                      })
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </CardFrame>
        )}

        {!loading && !fields.isError ? (
          <div className="flex items-center gap-2">
            <Switch
              id="custom-fields-show-deleted"
              checked={showDeleted}
              onCheckedChange={(value) =>
                void navigate({
                  to: routes.workspaceCustomFields.path,
                  search: value ? { deleted: true } : {},
                  replace: true,
                })
              }
            />
            <Label
              htmlFor="custom-fields-show-deleted"
              className="font-normal text-sm"
            >
              {t("customFields:list.showDeleted")}
            </Label>
          </div>
        ) : null}
        {active.length === 0 && orderedSections.length > 0 && !loading ? (
          <p className="text-muted-foreground text-sm">
            {t("customFields:list.noFields")}
          </p>
        ) : null}
      </div>
      {sectionDialog && workspace ? (
        <SectionDialog
          section={sectionDialog === "new" ? undefined : sectionDialog}
          workspaceId={workspace.id}
          onClose={() => setSectionDialog(null)}
          finalFocus={() => {
            const target = sectionDialogTrigger.current;
            return target?.isConnected && !target.disabled ? target : false;
          }}
        />
      ) : null}
    </>
  );
}
