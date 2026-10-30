import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardTitle,
  Checkbox,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@taskdesk/ui";
import { Archive, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor, {
  type CommentContentSnapshot,
} from "@/components/activity/comment-editor";
import PageTitle from "@/components/page-title";
import {
  archiveChecklistTemplate,
  archiveWorkItemTemplate,
  type ChecklistTemplateInput,
  listChecklistTemplates,
  listWorkItemTemplatesForManagement,
  saveChecklistTemplate,
  saveWorkItemTemplate,
  type WorkItemTemplateInput,
} from "@/fetchers/work-item-template/work-item-templates";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  parseWorkItemTemplateSearch,
  type WorkItemTemplateSearch,
} from "@/lib/routes";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/work-item-templates",
)({
  validateSearch: parseWorkItemTemplateSearch,
  component: WorkItemTemplatesPage,
});

type Template = Awaited<
  ReturnType<typeof listWorkItemTemplatesForManagement>
>[number];
type Checklist = Awaited<ReturnType<typeof listChecklistTemplates>>[number];
const EMPTY_DOCUMENT = { type: "doc", content: [{ type: "paragraph" }] };
const NO_CHECKLIST = "none";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function TemplateEditor({
  template,
  workspaceId,
  checklists,
  pending,
  error,
  onSave,
  onClose,
}: {
  template?: Template;
  workspaceId: string;
  checklists: Checklist[];
  pending: boolean;
  error: unknown;
  onSave: (input: WorkItemTemplateInput) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const types = useGetWorkItemTypes({ workspaceId });
  const labels = useGetLabelsByWorkspace(workspaceId);
  const [name, setName] = useState(template?.name ?? "");
  const [typeId, setTypeId] = useState(template?.typeId ?? "");
  const [title, setTitle] = useState(template?.title ?? "");
  const [labelIds, setLabelIds] = useState<string[]>(template?.labelIds ?? []);
  const [checklistId, setChecklistId] = useState(
    template?.checklistTemplateId ?? NO_CHECKLIST,
  );
  const [content, setContent] = useState<CommentContentSnapshot>({
    text: "",
    document: template?.description ?? EMPTY_DOCUMENT,
  });
  const selectedType = types.data?.find((type) => type.id === typeId);
  const selectedChecklist = checklists.find(
    (entry) => entry.id === checklistId,
  );
  const workspaceLabels = (labels.data ?? []).filter(
    (label) => !("projectId" in label) || !label.projectId,
  );
  const valid = name.trim() && title.trim() && typeId;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-w-2xl"
        closeLabel={t("common:actions.close")}
      >
        <DialogHeader>
          <DialogTitle>
            {t(
              template
                ? "settings:workItemTemplates.edit"
                : "settings:workItemTemplates.create",
            )}
          </DialogTitle>
          <DialogDescription>
            {t("settings:workItemTemplates.editorHelp")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !pending)
              onSave({
                name: name.trim(),
                typeId,
                title,
                description: content.document,
                labelIds,
                checklistTemplateId:
                  checklistId === NO_CHECKLIST ? null : checklistId,
              });
          }}
          className="space-y-4"
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="template-name">
                {t("settings:workItemTemplates.name")}
              </Label>
              <Input
                id="template-name"
                autoFocus
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-type">
                {t("settings:workItemTemplates.type")}
              </Label>
              <Select
                value={typeId}
                disabled={pending}
                onValueChange={(value) => setTypeId(value ?? "")}
              >
                <SelectTrigger id="template-type">
                  <SelectValue
                    placeholder={t(
                      "settings:workItemTemplates.typePlaceholder",
                    )}
                  >
                    {selectedType?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(types.data ?? []).map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-title">
                {t("settings:workItemTemplates.itemTitle")}
              </Label>
              <Input
                id="template-title"
                required
                maxLength={500}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t("settings:workItemTemplates.descriptionField")}
              </p>
              <CommentEditor
                value={content.text}
                documentValue={content.document}
                onContentChange={setContent}
                disabled={pending}
                showQuickAttachButton={false}
                enableMentions={false}
                placeholder={t(
                  "settings:workItemTemplates.descriptionPlaceholder",
                )}
              />
            </div>
            {workspaceLabels.length ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t("settings:workItemTemplates.labels")}
                </p>
                <div className="flex flex-wrap gap-4">
                  {workspaceLabels.map((label) => (
                    <div key={label.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`template-label-${label.id}`}
                        checked={labelIds.includes(label.id)}
                        disabled={pending}
                        onCheckedChange={(value) =>
                          setLabelIds((current) =>
                            value
                              ? [...current, label.id]
                              : current.filter((id) => id !== label.id),
                          )
                        }
                      />
                      <Label
                        htmlFor={`template-label-${label.id}`}
                        className="font-normal"
                      >
                        {label.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="template-checklist">
                {t("settings:workItemTemplates.checklist")}
              </Label>
              <Select
                value={checklistId}
                disabled={pending}
                onValueChange={(value) => setChecklistId(value ?? NO_CHECKLIST)}
              >
                <SelectTrigger id="template-checklist">
                  <SelectValue>
                    {selectedChecklist?.name ??
                      t("settings:workItemTemplates.noChecklist")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHECKLIST}>
                    {t("settings:workItemTemplates.noChecklist")}
                  </SelectItem>
                  {checklists.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("settings:workItemTemplates.copiedHelp")}
              </p>
            </div>
            {error ? (
              <Alert variant="error">
                <AlertDescription>
                  {errorText(error, t("settings:workItemTemplates.failed"))}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={onClose}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {t("settings:workItemTemplates.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChecklistEditor({
  checklist,
  pending,
  error,
  onSave,
  onClose,
}: {
  checklist?: Checklist;
  pending: boolean;
  error: unknown;
  onSave: (input: ChecklistTemplateInput) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(checklist?.name ?? "");
  const [items, setItems] = useState(
    (checklist?.items ?? []).map((item) => item.text).join("\n"),
  );
  const parsed = items
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>
            {t(
              checklist
                ? "settings:workItemTemplates.editChecklist"
                : "settings:workItemTemplates.createChecklist",
            )}
          </DialogTitle>
          <DialogDescription>
            {t("settings:workItemTemplates.checklistHelp")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !pending)
              onSave({ name: name.trim(), items: parsed });
          }}
          className="space-y-4"
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="checklist-name">
                {t("settings:workItemTemplates.name")}
              </Label>
              <Input
                id="checklist-name"
                autoFocus
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="checklist-items">
                {t("settings:workItemTemplates.checklistItems")}
              </Label>
              <Textarea
                id="checklist-items"
                rows={6}
                value={items}
                onChange={(event) => setItems(event.target.value)}
                disabled={pending}
              />
            </div>
            {error ? (
              <Alert variant="error">
                <AlertDescription>
                  {errorText(error, t("settings:workItemTemplates.failed"))}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={onClose}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {t("settings:workItemTemplates.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WorkItemTemplatesPage() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const cache = useQueryClient();
  const { workspace, canManageWorkspaceSettings, isCheckingPermissions } =
    useWorkspacePermission();
  const canManage = canManageWorkspaceSettings();
  const enabled = Boolean(workspace?.id && canManage);
  const showChecklists = search.library === "checklists";
  const templates = useQuery({
    queryKey: ["work-item-templates", "management", workspace?.id],
    enabled,
    queryFn: () => listWorkItemTemplatesForManagement(workspace?.id ?? ""),
  });
  const checklists = useQuery({
    queryKey: ["checklist-templates", "management", workspace?.id],
    enabled,
    queryFn: () => listChecklistTemplates(workspace?.id ?? ""),
  });
  const open = (next: WorkItemTemplateSearch) => {
    save.reset();
    void navigate({ search: next });
  };
  const close = () => open({ q: search.q, library: search.library });
  const save = useMutation({
    mutationFn: async (
      input:
        | { kind: "template"; value: WorkItemTemplateInput }
        | { kind: "checklist"; value: ChecklistTemplateInput },
    ) => {
      if (!workspace || !canManage)
        throw new Error(t("settings:workItemTemplates.forbidden"));
      const id = search.id === "new" ? undefined : search.id;
      return input.kind === "template"
        ? saveWorkItemTemplate(workspace.id, input.value, id)
        : saveChecklistTemplate(workspace.id, input.value, id);
    },
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["work-item-templates"] }),
        cache.invalidateQueries({ queryKey: ["checklist-templates"] }),
      ]);
      close();
    },
  });
  const archive = useMutation({
    mutationFn: async (target: {
      kind: "template" | "checklist";
      id: string;
    }) => {
      if (!workspace || !canManage)
        throw new Error(t("settings:workItemTemplates.forbidden"));
      return target.kind === "template"
        ? archiveWorkItemTemplate(workspace.id, target.id)
        : archiveChecklistTemplate(workspace.id, target.id);
    },
    onSuccess: async () => {
      toast.success(t("settings:workItemTemplates.archived"));
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["work-item-templates"] }),
        cache.invalidateQueries({ queryKey: ["checklist-templates"] }),
      ]);
    },
    onError: (cause) =>
      toast.error(errorText(cause, t("settings:workItemTemplates.failed"))),
  });
  const needle = (search.q ?? "").toLocaleLowerCase();
  const filteredTemplates = (templates.data ?? []).filter((row) =>
    row.name.toLocaleLowerCase().includes(needle),
  );
  const filteredChecklists = (checklists.data ?? []).filter((row) =>
    row.name.toLocaleLowerCase().includes(needle),
  );
  const selectedTemplate = templates.data?.find((row) => row.id === search.id);
  const selectedChecklist = checklists.data?.find(
    (row) => row.id === search.id,
  );
  const busy =
    !workspace ||
    isCheckingPermissions ||
    (canManage && (templates.isLoading || checklists.isLoading));
  const failed = templates.isError || checklists.isError;
  const rows = showChecklists ? filteredChecklists : filteredTemplates;
  return (
    <>
      <PageTitle title={t("settings:workItemTemplates.title")} />
      <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">
              {t("settings:workItemTemplates.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("settings:workItemTemplates.description")}
            </p>
          </div>
          {canManage && !busy ? (
            <Button onClick={() => open({ ...search, id: "new" })}>
              <Plus aria-hidden="true" />
              {t(
                showChecklists
                  ? "settings:workItemTemplates.createChecklist"
                  : "settings:workItemTemplates.create",
              )}
            </Button>
          ) : null}
        </div>
        {busy ? (
          <Skeleton className="h-24 w-full" />
        ) : !canManage ? (
          <Alert>
            <AlertDescription>
              {t("settings:workItemTemplates.forbidden")}
            </AlertDescription>
          </Alert>
        ) : failed ? (
          <Alert variant="error">
            <AlertDescription>
              {t("settings:workItemTemplates.loadFailed")}
            </AlertDescription>
            <Button
              variant="outline"
              onClick={() => {
                void templates.refetch();
                void checklists.refetch();
              }}
            >
              {t("common:actions.retry")}
            </Button>
          </Alert>
        ) : (
          <>
            <Tabs
              value={showChecklists ? "checklists" : "templates"}
              onValueChange={(value) =>
                open(
                  value === "checklists"
                    ? { q: search.q, library: "checklists" }
                    : { q: search.q },
                )
              }
            >
              <TabsList className="bg-sidebar gap-2">
                <TabsTrigger value="templates">
                  {t("settings:workItemTemplates.templatesTab")}
                </TabsTrigger>
                <TabsTrigger value="checklists">
                  {t("settings:workItemTemplates.checklistsTab")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Input
              aria-label={t("settings:workItemTemplates.search")}
              placeholder={t("settings:workItemTemplates.search")}
              value={search.q ?? ""}
              onChange={(event) =>
                void navigate({
                  search: { ...search, q: event.target.value || undefined },
                  replace: true,
                })
              }
            />
            {rows.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {t("settings:workItemTemplates.empty")}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t("settings:workItemTemplates.emptyDescription")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <CardFrame>
                {rows.map((row) => (
                  <Card key={row.id}>
                    <CardHeader>
                      <CardTitle>{row.name}</CardTitle>
                      <CardDescription>
                        {"items" in row
                          ? t("settings:workItemTemplates.itemCount", {
                              count: row.items.length,
                            })
                          : row.title}
                      </CardDescription>
                      <CardAction>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t(
                            "settings:workItemTemplates.editNamed",
                            {
                              name: row.name,
                            },
                          )}
                          onClick={() => open({ ...search, id: row.id })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t(
                            "settings:workItemTemplates.archiveNamed",
                            { name: row.name },
                          )}
                          disabled={
                            archive.isPending || Boolean(row.archivedAt)
                          }
                          onClick={() =>
                            archive.mutate({
                              kind: showChecklists ? "checklist" : "template",
                              id: row.id,
                            })
                          }
                        >
                          <Archive />
                        </Button>
                      </CardAction>
                    </CardHeader>
                  </Card>
                ))}
              </CardFrame>
            )}
            {search.id &&
            search.id !== "new" &&
            !(showChecklists ? selectedChecklist : selectedTemplate) ? (
              <Alert>
                <AlertDescription>
                  {t("settings:workItemTemplates.notFound")}
                </AlertDescription>
                <Button variant="outline" onClick={close}>
                  {t("common:actions.close")}
                </Button>
              </Alert>
            ) : null}
            {workspace &&
            search.id &&
            !showChecklists &&
            (search.id === "new" || selectedTemplate) ? (
              <TemplateEditor
                key={`${workspace.id}:${search.id}`}
                template={selectedTemplate}
                workspaceId={workspace.id}
                checklists={(checklists.data ?? []).filter(
                  (entry) => !entry.archivedAt,
                )}
                pending={save.isPending}
                error={save.error}
                onSave={(value) => save.mutate({ kind: "template", value })}
                onClose={close}
              />
            ) : null}
            {search.id &&
            showChecklists &&
            (search.id === "new" || selectedChecklist) ? (
              <ChecklistEditor
                key={`${workspace?.id}:${search.id}`}
                checklist={selectedChecklist}
                pending={save.isPending}
                error={save.error}
                onSave={(value) => save.mutate({ kind: "checklist", value })}
                onClose={close}
              />
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
