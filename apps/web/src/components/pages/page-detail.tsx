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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DocumentEditor } from "@/components/editor/document-editor";
import { LeaveUnsavedDialog } from "@/components/editor/leave-unsaved-dialog";
import {
  KbArticleContent,
  removedNodeTypes,
} from "@/components/kb/kb-article-content";
import PageTitle from "@/components/page-title";
import { TaskTitlePresentation } from "@/components/task/task-detail-presentation";
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
import { useDocumentAutosave } from "@/hooks/use-document-autosave";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import { descendantIds, flattenPageTree } from "./pages-tree";

const TOP_LEVEL = "none";

type Draft = { title: string; body: unknown; parentId: string | null };

function draftOf(page: Page): Draft {
  return { title: page.title, body: page.body, parentId: page.parentId };
}

/** Only what differs from what the server holds; an unchanged body is never re-sent. Null when nothing does. */
export function changesOf(saved: Draft, draft: Draft): PageInput | null {
  const changes: PageInput = {};
  const title = draft.title.trim();
  if (title && title !== saved.title) changes.title = title;
  // The editor emits a new document object for every edit, so identity tells an edit apart.
  if (draft.body !== saved.body) changes.body = draft.body;
  if (draft.parentId !== saved.parentId) changes.parentId = draft.parentId;
  return Object.keys(changes).length > 0 ? changes : null;
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
  onMissing,
}: {
  projectKey: string;
  page: Page;
  number: number;
  onRestore: () => void;
  restoring: boolean;
  onClose: () => void;
  /** The version no longer exists (merged into a later autosave, PG-4). */
  onMissing: () => void;
}) {
  const { t } = useTranslation("pages");
  const version = useQuery({
    queryKey: pageKeys.version(projectKey, page.id, number),
    queryFn: () => getPageVersion(projectKey, page.id, number),
    retry: (count, error) =>
      !(error instanceof HttpError && error.status < 500) && count < 2,
  });
  const missing =
    version.error instanceof HttpError && version.error.status === 404;
  const onMissingRef = useRef(onMissing);
  onMissingRef.current = onMissing;
  useEffect(() => {
    if (missing) onMissingRef.current();
  }, [missing]);
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
            <Alert variant={missing ? "info" : "error"}>
              <AlertDescription>
                {missing ? t("history.versionMoved") : t("history.loadFailed")}
              </AlertDescription>
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
  beforeRestore,
  onRestored,
}: {
  projectKey: string;
  page: Page;
  /** Saves pending edits first and returns the version the restore replaces. */
  beforeRestore: () => Promise<number>;
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
    mutationFn: async (number: number) =>
      restorePageVersion(projectKey, page.id, number, await beforeRestore()),
    onSuccess: async (restored) => {
      setPreviewing(null);
      cache.setQueryData(pageKeys.detail(projectKey, page.id), restored);
      onRestored(restored);
      await cache.invalidateQueries({ queryKey: pageKeys.all });
      toast.success(t("history.restored"));
    },
    onError: (error) => {
      // Autosave can merge the chosen version into a later one (PG-4): show the current list.
      if (error instanceof HttpError && error.status === 404) {
        setPreviewing(null);
        void versions.refetch();
        toast.error(t("history.versionMoved"));
        return;
      }
      toast.error(
        error instanceof PageConflictError
          ? t("history.restoreConflict")
          : t("history.restoreFailed"),
      );
    },
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
                {format.format(new Date(version.updatedAt))}
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
          onMissing={() => void versions.refetch()}
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
  const [conflict, setConflict] = useState<PageConflictError | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const list = useQuery({
    queryKey: pageKeys.list(projectKey),
    queryFn: () => getPages(projectKey),
  });

  // The draft is read when a save starts, so it lives in a ref; the state copy renders it.
  const draftRef = useRef<Draft>(draftOf(page));
  const [draft, setDraftState] = useState<Draft>(draftRef.current);
  /** What the server holds for this editor: the loaded page, then each saved result. */
  const saved = useRef<Draft>(draftOf(page));
  /** The body the editor loads from. Changes only on purpose, with `editorKey`. */
  const [editorBody, setEditorBody] = useState<unknown>(page.body);
  const [editorKey, setEditorKey] = useState(0);
  const reportedRemovals = useRef(new Set<string>());

  const autosave = useDocumentAutosave<PageInput, Page>({
    version: page.version,
    enabled: page.canEdit,
    getChanges: () => changesOf(saved.current, draftRef.current),
    canSave: () => draftRef.current.title.trim() !== "",
    save: (changes, expectedVersion) =>
      savePage(projectKey, page.id, expectedVersion, changes),
    isConflict: (error) => error instanceof PageConflictError,
    onSaved: (result, sent) => {
      saved.current = {
        title: result.title,
        parentId: result.parentId,
        body: "body" in sent ? sent.body : saved.current.body,
      };
      cache.setQueryData(pageKeys.detail(projectKey, page.id), result);
      // Coalescing renumbers the latest version, so the history is always refetched.
      void cache.invalidateQueries({
        queryKey: pageKeys.versions(projectKey, page.id),
      });
      void cache.invalidateQueries({ queryKey: pageKeys.list(projectKey) });
      // Say so once rather than lose content silently; the editor keeps what was typed.
      if ("body" in sent) {
        const removed = removedNodeTypes(sent.body, result.body).filter(
          (type) => !reportedRemovals.current.has(type),
        );
        for (const type of removed) reportedRemovals.current.add(type);
        if (removed.length > 0)
          toast.info(t("editor.removedTitle"), {
            description: t("editor.removedDescription", {
              types: removed.join(", "),
            }),
          });
      }
    },
    onConflict: (error) => {
      if (error instanceof PageConflictError) setConflict(error);
    },
    onError: (error) =>
      toast.error(
        error instanceof HttpError && error.status === 422
          ? error.message
          : t("editor.saveFailed"),
      ),
  });

  const edit = (patch: Partial<Draft>) => {
    draftRef.current = { ...draftRef.current, ...patch };
    setDraftState(draftRef.current);
    autosave.markDirty();
  };

  /** Load a page from the server into the editor, dropping unsaved edits (reload, restore). */
  const loadIntoEditor = (next: Page) => {
    autosave.reset(next.version);
    draftRef.current = draftOf(next);
    saved.current = draftOf(next);
    setDraftState(draftRef.current);
    setEditorBody(next.body);
    setEditorKey((value) => value + 1);
    setConflict(null);
  };

  // Someone else saved while this editor had nothing unsaved: show their page.
  const adoptRef = useRef(loadIntoEditor);
  adoptRef.current = loadIntoEditor;
  useEffect(() => {
    if (
      page.version > autosave.baseVersion() &&
      !autosave.hasUnsavedChanges() &&
      autosave.status === "saved"
    )
      adoptRef.current(page);
  }, [page, autosave]);

  const reloadLatest = async () => {
    try {
      const latest = await getPage(projectKey, page.id);
      cache.setQueryData(pageKeys.detail(projectKey, page.id), latest);
      void cache.invalidateQueries({
        queryKey: pageKeys.versions(projectKey, page.id),
      });
      loadIntoEditor(latest);
    } catch {
      toast.error(t("detail.loadFailedDescription"));
    }
  };

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
  const statusLabel = {
    saved: t("editor.saved"),
    unsaved: t("editor.unsaved"),
    saving: t("editor.saving"),
    paused: t("editor.autosavePaused"),
  }[autosave.status];

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          {page.canEdit ? (
            <div className="min-w-0 flex-1">
              <TaskTitlePresentation
                aria-label={t("fields.title")}
                aria-invalid={draft.title.trim() === "" || undefined}
                placeholder={t("editor.untitled")}
                maxLength={200}
                value={draft.title}
                onChange={(event) =>
                  edit({ title: event.target.value.replace(/[\r\n]+/g, " ") })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                onBlur={() => void autosave.flush()}
              />
            </div>
          ) : (
            <h1 className="min-w-0 truncate font-semibold text-2xl">
              {page.title}
            </h1>
          )}
          {page.canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="text-muted-foreground text-sm"
                aria-live="polite"
              >
                {statusLabel}
              </span>
              <Button
                variant="outline"
                onClick={() => setConfirmingDelete(true)}
              >
                {t("delete.action")}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <div className="min-w-0 space-y-4">
            {page.canEdit ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="page-edit-parent">{t("fields.parent")}</Label>
                  <Select
                    value={draft.parentId ?? TOP_LEVEL}
                    onValueChange={(value) => {
                      const parentId =
                        value && value !== TOP_LEVEL ? value : null;
                      if (parentId === draftRef.current.parentId) return;
                      edit({ parentId });
                      // A move is a discrete choice: save it now, not after the typing delay.
                      void autosave.flush();
                    }}
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
                <DocumentEditor
                  key={editorKey}
                  ariaLabel={t("editor.bodyLabel")}
                  documentValue={editorBody}
                  onDocumentChange={(document) => edit({ body: document })}
                  onBlur={() => void autosave.flush()}
                  placeholder={t("editor.bodyPlaceholder")}
                />
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
            beforeRestore={async () => {
              await autosave.flush();
              return autosave.baseVersion();
            }}
            onRestored={loadIntoEditor}
          />
        </div>
      </div>
      {conflict ? (
        <ConflictDialog
          conflict={conflict}
          busy={autosave.status === "saving"}
          onClose={() => setConflict(null)}
          onOverwrite={() => {
            autosave.resume(conflict.currentVersion);
            setConflict(null);
            void autosave.flush();
          }}
          onReload={() => void reloadLatest()}
        />
      ) : null}
      <LeaveUnsavedDialog
        leave={autosave.leave}
        labels={{
          title: t("editor.leaveTitle"),
          description: t("editor.leaveUnsaved"),
          stay: t("editor.stay"),
          leave: t("editor.leave"),
        }}
      />
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
  // Keyed by id only: saves update the cached page in place and must not remount the editor.
  return (
    <PageView key={query.data.id} projectKey={projectKey} page={query.data} />
  );
}
