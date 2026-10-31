import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/common/date-field";
import { DocumentEditor } from "@/components/editor/document-editor";
import { LeaveUnsavedDialog } from "@/components/editor/leave-unsaved-dialog";
import PageTitle from "@/components/page-title";
import {
  type KbArticle,
  type KbArticleInput,
  KbVersionConflictError,
  updateKbArticle,
} from "@/fetchers/kb";
import { kbKeys, useKbArticle, useKbCategories } from "@/hooks/queries/kb";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useDocumentAutosave } from "@/hooks/use-document-autosave";
import { HttpError } from "@/lib/http-error";
import { type KbEditorSearch, routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import {
  customerView,
  hasInternalContent,
  KbArticleContent,
  removedNodeTypes,
} from "../kb-article-content";
import { createKbOnlySlashCommands } from "./kb-editor-extensions";

const NONE = "none";

function dateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}
function isoDate(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

type Draft = {
  title: string;
  body: unknown;
  categoryId: string | null;
  projectId: string | null;
  ownerId: string | null;
  customerVisible: boolean;
  reviewDueAt: string;
};

function draftOf(article: KbArticle): Draft {
  return {
    title: article.title,
    body: article.body,
    categoryId: article.categoryId,
    projectId: article.projectId,
    ownerId: article.ownerId,
    customerVisible: article.customerVisible,
    reviewDueAt: dateInput(article.reviewDueAt),
  };
}

/** Only the fields that differ from what was loaded; an unchanged body is never re-sent. */
export function changesOf(
  article: KbArticle,
  draft: Draft,
  bodyEdited: boolean,
  canPublish: boolean,
): KbArticleInput {
  const changes: KbArticleInput = {};
  if (draft.title.trim() !== article.title) changes.title = draft.title.trim();
  if (bodyEdited) changes.body = draft.body;
  if (draft.categoryId !== article.categoryId)
    changes.categoryId = draft.categoryId;
  if (draft.reviewDueAt !== dateInput(article.reviewDueAt))
    changes.reviewDueAt = isoDate(draft.reviewDueAt);
  if (draft.ownerId !== article.ownerId) changes.ownerId = draft.ownerId;
  if (canPublish) {
    if (draft.customerVisible !== article.customerVisible)
      changes.customerVisible = draft.customerVisible;
    if (draft.projectId !== article.projectId)
      changes.projectId = draft.projectId;
  }
  return changes;
}

/** The two-author case: show both versions and let the editor choose. */
function ConflictDialog({
  mine,
  theirs,
  onKeepMine,
  onUseTheirs,
  onClose,
  busy,
}: {
  mine: Draft;
  theirs: KbArticle;
  onKeepMine: () => void;
  onUseTheirs: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        closeLabel={t("common:actions.close")}
        className="max-w-4xl"
      >
        <DialogHeader>
          <DialogTitle>{t("kb:conflict.title")}</DialogTitle>
          <DialogDescription>{t("kb:conflict.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-4 overflow-y-auto px-6 md:grid-cols-2">
          <section aria-label={t("kb:conflict.mine")} className="space-y-2">
            <h3 className="font-medium text-sm">{t("kb:conflict.mine")}</h3>
            <p className="font-semibold">{mine.title}</p>
            <KbArticleContent body={mine.body} />
          </section>
          <section aria-label={t("kb:conflict.theirs")} className="space-y-2">
            <h3 className="font-medium text-sm">{t("kb:conflict.theirs")}</h3>
            <p className="font-semibold">{theirs.title}</p>
            <KbArticleContent body={theirs.body} />
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onUseTheirs}>
            {t("kb:conflict.useTheirs")}
          </Button>
          <Button disabled={busy} onClick={onKeepMine}>
            {t("kb:conflict.keepMine")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Editor({
  article,
  canPublish,
  search,
  onSearchChange,
}: {
  article: KbArticle;
  canPublish: boolean;
  search: KbEditorSearch;
  onSearchChange: (next: KbEditorSearch) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const kbSlashCommands = useMemo(
    () =>
      // DocumentEditor brings the shared info callout; KB adds only its own actions.
      createKbOnlySlashCommands({
        internalCallout: t("kb:editor.slashInternalCallout"),
        internalCalloutSearch: t("kb:editor.searchInternalCallout"),
        workItemReference: t("kb:editor.slashWorkItemReference"),
        workItemReferenceSearch: t("kb:editor.searchWorkItemReference"),
      }),
    [t],
  );
  const categories = useKbCategories(article.workspaceId);
  const projects = useGetProjects(
    { workspaceId: article.workspaceId },
    canPublish,
  );
  const workspaceUsers = useGetActiveWorkspaceUsers(article.workspaceId);
  const ownerChoices = (workspaceUsers.data?.members ?? []).flatMap((member) =>
    member.personId
      ? [
          {
            id: member.personId,
            label: member.user?.name || member.user?.email || member.personId,
          },
        ]
      : [],
  );
  const [base, setBase] = useState(article);
  // The draft is read when a save starts, so it lives in a ref; the state copy renders it.
  const draftRef = useRef<Draft>(draftOf(article));
  const [draft, setDraftState] = useState<Draft>(draftRef.current);
  /** What the server holds: the loaded article, then each saved one, and the body last sent. */
  const saved = useRef({ article, body: article.body as unknown });
  /** The body the editor loads from. Changes only on purpose, with `generation`. */
  const [editorBody, setEditorBody] = useState<unknown>(article.body);
  const [generation, setGeneration] = useState(0);
  const [conflict, setConflict] = useState<KbArticle | null>(null);
  const reportedRemovals = useRef(new Set<string>());
  const preview = search.preview === true;

  const autosave = useDocumentAutosave<KbArticleInput, KbArticle>({
    version: article.version,
    getChanges: () => {
      const changes = changesOf(
        saved.current.article,
        draftRef.current,
        draftRef.current.body !== saved.current.body,
        canPublish,
      );
      return Object.keys(changes).length > 0 ? changes : null;
    },
    canSave: () => draftRef.current.title.trim() !== "",
    save: (changes, version) => updateKbArticle(article.id, version, changes),
    isConflict: (error) => error instanceof KbVersionConflictError,
    onSaved: (result, sent) => {
      saved.current = {
        article: result,
        body: "body" in sent ? sent.body : saved.current.body,
      };
      // Only the base moves on; the draft (and the editor) keep what is being typed.
      setBase(result);
      queryClient.setQueryData(kbKeys.article(article.id), (old: unknown) =>
        old && typeof old === "object" ? { ...old, article: result } : old,
      );
      void queryClient.invalidateQueries({
        queryKey: kbKeys.all(article.workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: kbKeys.versions(article.id),
      });
      // The server keeps only what articles may hold; say so once rather than lose content silently.
      if ("body" in sent) {
        const removed = removedNodeTypes(sent.body, result.body).filter(
          (type) => !reportedRemovals.current.has(type),
        );
        for (const type of removed) reportedRemovals.current.add(type);
        if (removed.length > 0)
          toast.info(t("kb:editor.removedTitle"), {
            description: t("kb:editor.removedDescription", {
              types: removed.join(", "),
            }),
          });
      }
    },
    onConflict: (error) => {
      if (error instanceof KbVersionConflictError) setConflict(error.current);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  });

  const edit = (patch: Partial<Draft>) => {
    draftRef.current = { ...draftRef.current, ...patch };
    setDraftState(draftRef.current);
    autosave.markDirty();
  };
  /** Settings are discrete choices (like Kaneo's task properties): saved at once, not after the typing delay. */
  const choose = (patch: Partial<Draft>) => {
    edit(patch);
    void autosave.flush();
  };

  const internal = hasInternalContent(draft.body);
  return (
    <>
      <PageTitle title={t("kb:editor.pageTitle", { title: base.title })} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <Breadcrumb label={t("kb:article.breadcrumb")}>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to={routes.kb.path} />}>
                {t("kb:list.title")}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink
                render={
                  <Link
                    to={routes.kbArticle.path}
                    params={{ id: article.id }}
                  />
                }
              >
                {base.title}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{t("kb:editor.crumb")}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{t("kb:editor.title")}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="kb-preview"
                checked={preview}
                onCheckedChange={(checked) =>
                  onSearchChange({ preview: checked || undefined })
                }
              />
              <Label htmlFor="kb-preview">
                {t("kb:editor.customerPreview")}
              </Label>
            </div>
            <span className="text-muted-foreground text-sm" aria-live="polite">
              {
                {
                  saved: t("kb:editor.allSaved"),
                  unsaved: t("kb:editor.unsaved"),
                  saving: t("kb:editor.saving"),
                  paused: t("kb:editor.autosavePaused"),
                }[autosave.status]
              }
            </span>
            <Button
              variant="outline"
              render={
                <Link to={routes.kbArticle.path} params={{ id: article.id }} />
              }
            >
              {t("kb:editor.done")}
            </Button>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <div className="min-w-0 space-y-4">
            {preview ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {draft.title || t("kb:editor.untitled")}
                  </CardTitle>
                  <CardDescription>
                    {t("kb:editor.previewDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!draft.customerVisible || base.state !== "published" ? (
                    <Alert variant="info">
                      <AlertDescription>
                        {t("kb:editor.previewNotVisible")}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {internal ? (
                    <Alert variant="info">
                      <AlertTitle>
                        {t("kb:editor.previewHiddenTitle")}
                      </AlertTitle>
                      <AlertDescription>
                        {t("kb:editor.previewHiddenDescription")}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <KbArticleContent body={customerView(draft.body)} />
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="kb-title">{t("kb:fields.title")}</Label>
                  <Input
                    id="kb-title"
                    maxLength={200}
                    value={draft.title}
                    aria-invalid={draft.title.trim() === "" || undefined}
                    onChange={(event) => edit({ title: event.target.value })}
                    onBlur={() => void autosave.flush()}
                  />
                </div>
                <Field className="items-stretch">
                  <DocumentEditor
                    key={generation}
                    ariaLabel={t("kb:editor.bodyLabel")}
                    documentValue={editorBody}
                    onDocumentChange={(document) => edit({ body: document })}
                    onBlur={() => void autosave.flush()}
                    placeholder={t("kb:editor.bodyPlaceholder")}
                    additionalSlashCommands={kbSlashCommands}
                  />
                  <FieldDescription>
                    {t("kb:editor.workItemReferenceHelp")}
                  </FieldDescription>
                </Field>
              </>
            )}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t("kb:editor.settingsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="kb-owner">{t("kb:fields.owner")}</Label>
                <Select
                  value={draft.ownerId ?? NONE}
                  items={[
                    { value: NONE, label: t("kb:fields.none") },
                    ...ownerChoices.map((owner) => ({
                      value: owner.id,
                      label: owner.label,
                    })),
                  ]}
                  onValueChange={(value) =>
                    choose({ ownerId: value && value !== NONE ? value : null })
                  }
                >
                  <SelectTrigger id="kb-owner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("kb:fields.none")}</SelectItem>
                    {ownerChoices.map((owner) => (
                      <SelectItem key={owner.id} value={owner.id}>
                        {owner.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {t("kb:editor.ownerHelp")}
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="kb-category">{t("kb:fields.category")}</Label>
                <Select
                  value={draft.categoryId ?? NONE}
                  items={[
                    { value: NONE, label: t("kb:fields.none") },
                    ...(categories.data?.categories ?? []).map((category) => ({
                      value: category.id,
                      label: category.name,
                    })),
                  ]}
                  onValueChange={(value) =>
                    choose({
                      categoryId: value && value !== NONE ? value : null,
                    })
                  }
                >
                  <SelectTrigger id="kb-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("kb:fields.none")}</SelectItem>
                    {(categories.data?.categories ?? []).map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="kb-review-due">
                  {t("kb:fields.reviewDue")}
                </Label>
                <DateField
                  id="kb-review-due"
                  label={t("kb:fields.reviewDue")}
                  placeholder={t("customFields:value.notSet")}
                  clearLabel={t("common:clearDate")}
                  value={draft.reviewDueAt}
                  dateEntry={{
                    label: t("common:dateEntry", {
                      label: t("kb:fields.reviewDue"),
                    }),
                    invalidLabel: t("common:invalidDate"),
                    saveLabel: t("common:actions.save"),
                  }}
                  onChange={(value) => choose({ reviewDueAt: value })}
                />
                <p className="text-muted-foreground text-xs">
                  {t("kb:editor.reviewDueHelp")}
                </p>
              </div>
              {canPublish ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="kb-project">{t("kb:fields.project")}</Label>
                    <Select
                      value={draft.projectId ?? NONE}
                      items={[
                        { value: NONE, label: t("kb:editor.workspaceWide") },
                        ...(projects.data ?? []).map((project) => ({
                          value: project.id,
                          label: project.name,
                        })),
                      ]}
                      onValueChange={(value) =>
                        choose({
                          projectId: value && value !== NONE ? value : null,
                        })
                      }
                    >
                      <SelectTrigger id="kb-project">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>
                          {t("kb:editor.workspaceWide")}
                        </SelectItem>
                        {(projects.data ?? []).map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-xs">
                      {t("kb:editor.projectHelp")}
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Switch
                      id="kb-customer-visible"
                      checked={draft.customerVisible}
                      onCheckedChange={(checked) =>
                        choose({ customerVisible: checked })
                      }
                    />
                    <div className="space-y-1">
                      <Label htmlFor="kb-customer-visible">
                        {t("kb:fields.customerVisible")}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {t("kb:editor.customerVisibleHelp")}
                      </p>
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
      {conflict ? (
        <ConflictDialog
          mine={draft}
          theirs={conflict}
          busy={autosave.status === "saving"}
          onClose={() => setConflict(null)}
          onKeepMine={() => {
            // Their article becomes the base, so every field that differs from it is re-sent.
            saved.current = { article: conflict, body: conflict.body };
            setBase(conflict);
            setConflict(null);
            autosave.resume(conflict.version);
            autosave.markDirty();
            void autosave.flush();
          }}
          onUseTheirs={() => {
            autosave.reset(conflict.version);
            saved.current = { article: conflict, body: conflict.body };
            draftRef.current = draftOf(conflict);
            setBase(conflict);
            setDraftState(draftRef.current);
            setEditorBody(conflict.body);
            setGeneration((value) => value + 1);
            setConflict(null);
          }}
        />
      ) : null}
      <LeaveUnsavedDialog
        leave={autosave.leave}
        labels={{
          title: t("kb:editor.leaveTitle"),
          description: t("kb:editor.leaveUnsaved"),
          stay: t("kb:editor.stay"),
          leave: t("kb:editor.leave"),
        }}
      />
    </>
  );
}

/** `docs/screens.md` "Article editor": Kaneo's rich-text editor with a live customer preview. */
export function KbArticleEditor({
  id,
  search,
  onSearchChange,
}: {
  id: string;
  search: KbEditorSearch;
  onSearchChange: (next: KbEditorSearch) => void;
}) {
  const { t } = useTranslation();
  const detail = useKbArticle(id);
  if (detail.isLoading) return <Skeleton className="m-6 h-40" />;
  if (detail.isError || !detail.data) {
    const missing =
      detail.error instanceof HttpError && detail.error.status === 404;
    return (
      <div className="p-6">
        <Alert variant="error">
          <AlertTitle>
            {missing
              ? t("kb:article.notFoundTitle")
              : t("kb:article.loadErrorTitle")}
          </AlertTitle>
          <AlertDescription>
            {missing
              ? t("kb:article.notFoundDescription")
              : t("kb:article.loadErrorDescription")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!detail.data.canWrite || detail.data.article.state === "archived")
    return (
      <div className="p-6">
        <Alert variant="info">
          <AlertTitle>{t("kb:editor.readOnlyTitle")}</AlertTitle>
          <AlertDescription>
            {t("kb:editor.readOnlyDescription")}
          </AlertDescription>
        </Alert>
      </div>
    );
  return (
    <Editor
      key={detail.data.article.id}
      article={detail.data.article}
      canPublish={detail.data.canPublish}
      search={search}
      onSearchChange={onSearchChange}
    />
  );
}
