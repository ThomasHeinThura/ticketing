import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
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
} from "@taskdesk/ui";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { KbArticleContent } from "@/components/kb/kb-article-content";
import PageTitle from "@/components/page-title";
import {
  getPage,
  getPages,
  getPageVersion,
  getPageVersions,
  type Page,
  PageConflictError,
  type PageInput,
  type PageVersionSummary,
  pageKeys,
  requestPageDeletion,
  restorePageVersion,
  savePage,
} from "@/fetchers/pages";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import { descendantIds, flattenPageTree } from "./pages-tree";

const TOP_LEVEL = "none";

type Draft = { title: string; body: unknown; parentId: string | null };

function draftOf(page: Page): Draft {
  return { title: page.title, body: page.body, parentId: page.parentId };
}

/** Only what differs from the loaded page; an unchanged body is never re-sent. */
function changesOf(page: Page, draft: Draft, bodyEdited: boolean): PageInput {
  const changes: PageInput = {};
  if (draft.title.trim() !== page.title) changes.title = draft.title.trim();
  if (bodyEdited) changes.body = draft.body;
  if (draft.parentId !== page.parentId) changes.parentId = draft.parentId;
  return changes;
}

function useDateTime() {
  const { i18n } = useTranslation();
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** `PG-4`: one earlier version, previewed in full and restorable as a new version. */
function VersionPreview({
  projectKey,
  page,
  number,
  onRestore,
  restoring,
  onClose,
}: {
  projectKey: string;
  page: Page;
  number: number;
  onRestore: () => void;
  restoring: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("pages");
  const version = useQuery({
    queryKey: pageKeys.version(projectKey, page.id, number),
    queryFn: () => getPageVersion(projectKey, page.id, number),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !restoring && onClose()}>
      <DialogContent closeLabel={t("common.close")} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("history.previewTitle", { number })}</DialogTitle>
          <DialogDescription>
            {t("history.previewDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-6">
          {version.isLoading ? <Skeleton className="h-32 w-full" /> : null}
          {version.isError ? (
            <Alert variant="error">
              <AlertDescription>{t("history.loadFailed")}</AlertDescription>
            </Alert>
          ) : null}
          {version.data ? (
            <>
              <p className="font-semibold">{version.data.title}</p>
              <KbArticleContent body={version.data.body} />
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={restoring} onClick={onClose}>
            {t("common.close")}
          </Button>
          {page.canEdit && number !== page.version ? (
            <Button disabled={restoring || !version.data} onClick={onRestore}>
              {t("history.restore")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function History({
  projectKey,
  page,
  onRestored,
}: {
  projectKey: string;
  page: Page;
  onRestored: (page: Page) => void;
}) {
  const { t } = useTranslation("pages");
  const format = useDateTime();
  const cache = useQueryClient();
  const [previewing, setPreviewing] = useState<number | null>(null);
  const versions = useQuery({
    queryKey: pageKeys.versions(projectKey, page.id),
    queryFn: () => getPageVersions(projectKey, page.id),
  });
  const restore = useMutation({
    mutationFn: (number: number) =>
      restorePageVersion(projectKey, page.id, number, page.version),
    onSuccess: async (restored) => {
      setPreviewing(null);
      await cache.invalidateQueries({ queryKey: pageKeys.all });
      toast.success(t("history.restored"));
      onRestored(restored);
    },
    onError: (error) =>
      toast.error(
        error instanceof PageConflictError
          ? t("history.restoreConflict")
          : t("history.restoreFailed"),
      ),
  });
  const label = (version: PageVersionSummary) =>
    version.kind === "restore" && version.restoredFrom
      ? t("history.kind.restore", { from: version.restoredFrom })
      : t(`history.kind.${version.kind}`);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("history.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {versions.isLoading ? <Skeleton className="h-20 w-full" /> : null}
        {versions.isError ? (
          <Alert variant="error">
            <AlertDescription>{t("history.loadFailed")}</AlertDescription>
          </Alert>
        ) : null}
        <ol className="flex flex-col gap-2" aria-label={t("history.title")}>
          {(versions.data?.versions ?? []).map((version) => (
            <li
              key={version.number}
              className="flex flex-col gap-1 rounded-md border px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">
                  {t("history.version", { number: version.number })}
                </span>
                {version.number === page.version ? (
                  <Badge variant="secondary">{t("history.current")}</Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs">
                {label(version)}
                {" · "}
                {version.createdBy?.name ?? t("common.unknownPerson")}
                {" · "}
                {format.format(new Date(version.createdAt))}
              </p>
              <Button
                size="xs"
                variant="outline"
                className="self-start"
                onClick={() => setPreviewing(version.number)}
              >
                {t("history.view")}
              </Button>
            </li>
          ))}
        </ol>
      </CardContent>
      {previewing !== null ? (
        <VersionPreview
          projectKey={projectKey}
          page={page}
          number={previewing}
          restoring={restore.isPending}
          onRestore={() => restore.mutate(previewing)}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
    </Card>
  );
}

/** `PG-5`: the page moved on while this editor was open. */
function ConflictDialog({
  conflict,
  busy,
  onOverwrite,
  onReload,
  onClose,
}: {
  conflict: PageConflictError;
  busy: boolean;
  onOverwrite: () => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("pages");
  const format = useDateTime();
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("conflict.title")}</DialogTitle>
          <DialogDescription>
            {t("conflict.description", {
              name: conflict.updatedBy?.name ?? t("common.unknownPerson"),
              date: conflict.updatedAt
                ? format.format(new Date(conflict.updatedAt))
                : "",
              version: conflict.currentVersion,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("conflict.keepEditing")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onReload}>
            {t("conflict.loadLatest")}
          </Button>
          <Button disabled={busy} onClick={onOverwrite}>
            {t("conflict.overwrite")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PageView({ projectKey, page }: { projectKey: string; page: Page }) {
  const { t } = useTranslation("pages");
  const cache = useQueryClient();
  const openPendingAction = useOpenPendingAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(page));
  const [bodyEdited, setBodyEdited] = useState(false);
  // Tiptap reports updates of its own while it mounts; only edits after an interaction count.
  const interacted = useRef(false);
  const [generation, setGeneration] = useState(0);
  const [conflict, setConflict] = useState<PageConflictError | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const list = useQuery({
    queryKey: pageKeys.list(projectKey),
    queryFn: () => getPages(projectKey),
  });
  const changes = changesOf(page, draft, bodyEdited);
  const dirty = Object.keys(changes).length > 0;

  const startEditing = () => {
    setDraft(draftOf(page));
    setBodyEdited(false);
    interacted.current = false;
    setGeneration((value) => value + 1);
    setEditing(true);
  };

  const refresh = () => cache.invalidateQueries({ queryKey: pageKeys.all });

  const save = useMutation({
    mutationFn: (version: number) =>
      savePage(projectKey, page.id, version, changes),
    onSuccess: async () => {
      setConflict(null);
      setEditing(false);
      await refresh();
      toast.success(t("editor.saved"));
    },
    onError: (error) => {
      if (error instanceof PageConflictError) setConflict(error);
      else
        toast.error(
          error instanceof HttpError && error.status === 422
            ? error.message
            : t("editor.saveFailed"),
        );
    },
  });
  const remove = useMutation({
    mutationFn: () => requestPageDeletion(projectKey, page.id),
    onSuccess: (pending) => {
      setConfirmingDelete(false);
      void openPendingAction(pending);
    },
    onError: (error) => {
      setConfirmingDelete(false);
      toast.error(
        error instanceof HttpError && error.status === 409
          ? t("delete.hasChildren")
          : t("delete.failed"),
      );
    },
  });

  const excluded = descendantIds(list.data?.pages ?? [], page.id);
  const parents = flattenPageTree(
    (list.data?.pages ?? []).filter((candidate) => !excluded.has(candidate.id)),
  );
  const parentTitle = (list.data?.pages ?? []).find(
    (candidate) => candidate.id === page.parentId,
  )?.title;

  return (
    <>
      <PageTitle title={t("detail.pageTitle", { title: page.title })} />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
        <Breadcrumb label={t("detail.breadcrumb")}>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink
                render={
                  <Link
                    to="/agent/projects/$projectKey/pages"
                    params={{ projectKey }}
                  />
                }
              >
                {t("list.title")}
              </BreadcrumbLink>
            </BreadcrumbItem>
            {parentTitle ? (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink
                    render={
                      <Link
                        to="/agent/projects/$projectKey/pages/$pageId"
                        params={{ projectKey, pageId: page.parentId ?? "" }}
                      />
                    }
                  >
                    {parentTitle}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            ) : null}
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{page.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 truncate font-semibold text-2xl">
            {editing ? draft.title || t("editor.untitled") : page.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <span
                  className="text-muted-foreground text-sm"
                  aria-live="polite"
                >
                  {dirty ? t("editor.unsaved") : t("editor.allSaved")}
                </span>
                <Button
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => setEditing(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  disabled={!dirty || save.isPending || !draft.title.trim()}
                  onClick={() => save.mutate(page.version)}
                >
                  {t("editor.save")}
                </Button>
              </>
            ) : page.canEdit ? (
              <>
                <Button variant="outline" onClick={startEditing}>
                  {t("detail.edit")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirmingDelete(true)}
                >
                  {t("delete.action")}
                </Button>
              </>
            ) : null}
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <div className="min-w-0 space-y-4">
            {editing ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="page-edit-title">{t("fields.title")}</Label>
                  <Input
                    id="page-edit-title"
                    maxLength={200}
                    value={draft.title}
                    disabled={save.isPending}
                    onChange={(event) =>
                      setDraft((old) => ({ ...old, title: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="page-edit-parent">{t("fields.parent")}</Label>
                  <Select
                    value={draft.parentId ?? TOP_LEVEL}
                    onValueChange={(value) =>
                      setDraft((old) => ({
                        ...old,
                        parentId: value && value !== TOP_LEVEL ? value : null,
                      }))
                    }
                  >
                    <SelectTrigger id="page-edit-parent">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TOP_LEVEL}>
                        {t("fields.topLevel")}
                      </SelectItem>
                      {parents.map(({ page: candidate, depth }) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {`${"– ".repeat(depth)}${candidate.title}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: only notes the first interaction */}
                <div
                  className="rounded-lg border p-3"
                  onFocus={() => {
                    interacted.current = true;
                  }}
                  onKeyDown={() => {
                    interacted.current = true;
                  }}
                  onPointerDown={() => {
                    interacted.current = true;
                  }}
                  onPaste={() => {
                    interacted.current = true;
                  }}
                  onDrop={() => {
                    interacted.current = true;
                  }}
                >
                  <CommentEditor
                    key={generation}
                    ariaLabel={t("editor.bodyLabel")}
                    value=""
                    documentValue={draft.body}
                    onDocumentChange={(document) => {
                      if (!interacted.current) return;
                      setBodyEdited(true);
                      setDraft((old) => ({ ...old, body: document }));
                    }}
                    enableMentions={false}
                    showQuickAttachButton={false}
                    placeholder={t("editor.bodyPlaceholder")}
                  />
                </div>
              </>
            ) : (
              <Card>
                <CardContent className="py-4">
                  <KbArticleContent body={page.body} />
                </CardContent>
              </Card>
            )}
          </div>
          <History
            projectKey={projectKey}
            page={page}
            onRestored={() => setEditing(false)}
          />
        </div>
      </div>
      {conflict ? (
        <ConflictDialog
          conflict={conflict}
          busy={save.isPending}
          onClose={() => setConflict(null)}
          onOverwrite={() => save.mutate(conflict.currentVersion)}
          onReload={() => {
            setConflict(null);
            setEditing(false);
            void refresh();
          }}
        />
      ) : null}
      {confirmingDelete ? (
        <Dialog
          open
          onOpenChange={(open) =>
            !open && !remove.isPending && setConfirmingDelete(false)
          }
        >
          <DialogContent closeLabel={t("common.close")}>
            <DialogHeader>
              <DialogTitle>{t("delete.title")}</DialogTitle>
              <DialogDescription>
                {t("delete.description", { title: page.title })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={remove.isPending}
                onClick={() => setConfirmingDelete(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {t("delete.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** `docs/screens.md` "Page view and editor": Kaneo's rich-text editor with a history panel. */
export function PageDetail({
  projectKey,
  pageId,
}: {
  projectKey: string;
  pageId: string;
}) {
  const { t } = useTranslation("pages");
  const query = useQuery({
    queryKey: pageKeys.detail(projectKey, pageId),
    queryFn: () => getPage(projectKey, pageId),
    retry: (count, error) =>
      !(error instanceof HttpError && error.status < 500) && count < 2,
  });
  if (query.isLoading)
    return (
      <div
        className="mx-auto flex max-w-6xl flex-col gap-3 p-4"
        role="status"
        aria-label={t("common.loading")}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (query.isError || !query.data) {
    const missing =
      query.error instanceof HttpError && query.error.status === 404;
    return (
      <div className="mx-auto max-w-4xl p-4">
        <Alert variant="error">
          <AlertTitle>
            {missing ? t("detail.notFoundTitle") : t("detail.loadFailedTitle")}
          </AlertTitle>
          <AlertDescription>
            {missing
              ? t("detail.notFoundDescription")
              : t("detail.loadFailedDescription")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  // Keyed by id and version so an edit session starts from the saved page after a save or restore.
  return (
    <PageView
      key={`${query.data.id}:${query.data.version}`}
      projectKey={projectKey}
      page={query.data}
    />
  );
}
