import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import PageTitle from "@/components/page-title";
import {
  type KbArticle,
  type KbArticleInput,
  KbVersionConflictError,
  updateKbArticle,
} from "@/fetchers/kb";
import { kbKeys, useKbArticle, useKbCategories } from "@/hooks/queries/kb";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { HttpError } from "@/lib/http-error";
import { type KbEditorSearch, routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import {
  customerView,
  hasInternalContent,
  KbArticleContent,
  removedNodeTypes,
} from "../kb-article-content";

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
  customerVisible: boolean;
  reviewDueAt: string;
};

function draftOf(article: KbArticle): Draft {
  return {
    title: article.title,
    body: article.body,
    categoryId: article.categoryId,
    projectId: article.projectId,
    customerVisible: article.customerVisible,
    reviewDueAt: dateInput(article.reviewDueAt),
  };
}

/** Only the fields that differ from what was loaded; an unchanged body is never re-sent. */
function changesOf(
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
  const categories = useKbCategories(article.workspaceId);
  const projects = useGetProjects(
    { workspaceId: article.workspaceId },
    canPublish,
  );
  const [base, setBase] = useState(article);
  const [draft, setDraft] = useState<Draft>(() => draftOf(article));
  const [bodyEdited, setBodyEdited] = useState(false);
  // Tiptap reports updates of its own while it mounts; only edits after an interaction count.
  const interacted = useRef(false);
  const touch = () => {
    interacted.current = true;
  };
  const [conflict, setConflict] = useState<KbArticle | null>(null);
  const [generation, setGeneration] = useState(0);
  const preview = search.preview === true;
  const changes = changesOf(base, draft, bodyEdited, canPublish);
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: ({ version }: { version: number }) =>
      updateKbArticle(article.id, version, changes),
    onSuccess: async (saved) => {
      // The server keeps only what articles may hold; say so rather than lose content silently.
      const removed = bodyEdited
        ? removedNodeTypes(draft.body, saved.body)
        : [];
      setConflict(null);
      setBase(saved);
      setBodyEdited(false);
      setDraft(draftOf(saved));
      queryClient.setQueryData(kbKeys.article(article.id), (old: unknown) =>
        old && typeof old === "object" ? { ...old, article: saved } : old,
      );
      await queryClient.invalidateQueries({ queryKey: ["kb"] });
      toast.success(t("kb:editor.saved"));
      if (removed.length > 0)
        toast.info(t("kb:editor.removedTitle"), {
          description: t("kb:editor.removedDescription", {
            types: removed.join(", "),
          }),
        });
    },
    onError: (error) => {
      if (error instanceof KbVersionConflictError) setConflict(error.current);
      else toast.error(error.message);
    },
  });

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
              {dirty ? t("kb:editor.unsaved") : t("kb:editor.allSaved")}
            </span>
            <Button
              variant="outline"
              render={
                <Link to={routes.kbArticle.path} params={{ id: article.id }} />
              }
            >
              {t("kb:editor.done")}
            </Button>
            <Button
              disabled={!dirty || save.isPending || !draft.title.trim()}
              onClick={() => save.mutate({ version: base.version })}
            >
              {t("common:actions.save")}
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
                    disabled={save.isPending}
                    onChange={(event) =>
                      setDraft((old) => ({ ...old, title: event.target.value }))
                    }
                  />
                </div>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: only notes the first interaction */}
                <div
                  className="rounded-lg border p-3"
                  onFocus={touch}
                  onKeyDown={touch}
                  onPointerDown={touch}
                  onPaste={touch}
                  onDrop={touch}
                >
                  <CommentEditor
                    key={generation}
                    ariaLabel={t("kb:editor.bodyLabel")}
                    value=""
                    documentValue={draft.body}
                    onDocumentChange={(document) => {
                      if (!interacted.current) return;
                      setBodyEdited(true);
                      setDraft((old) => ({ ...old, body: document }));
                    }}
                    enableMentions={false}
                    showQuickAttachButton={false}
                    placeholder={t("kb:editor.bodyPlaceholder")}
                  />
                </div>
              </>
            )}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t("kb:editor.settingsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="kb-category">{t("kb:fields.category")}</Label>
                <Select
                  value={draft.categoryId ?? NONE}
                  onValueChange={(value) =>
                    setDraft((old) => ({
                      ...old,
                      categoryId: value && value !== NONE ? value : null,
                    }))
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
                <Input
                  id="kb-review-due"
                  type="date"
                  value={draft.reviewDueAt}
                  onChange={(event) =>
                    setDraft((old) => ({
                      ...old,
                      reviewDueAt: event.target.value,
                    }))
                  }
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
                      onValueChange={(value) =>
                        setDraft((old) => ({
                          ...old,
                          projectId: value && value !== NONE ? value : null,
                        }))
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
                        setDraft((old) => ({
                          ...old,
                          customerVisible: checked,
                        }))
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
          busy={save.isPending}
          onClose={() => setConflict(null)}
          onKeepMine={() => {
            setBase(conflict);
            save.mutate({ version: conflict.version });
          }}
          onUseTheirs={() => {
            setBase(conflict);
            setDraft(draftOf(conflict));
            setBodyEdited(false);
            interacted.current = false;
            setGeneration((value) => value + 1);
            setConflict(null);
          }}
        />
      ) : null}
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
