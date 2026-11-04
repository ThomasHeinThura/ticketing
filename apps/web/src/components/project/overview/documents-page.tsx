import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertAction,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Skeleton,
  Switch,
  Textarea,
} from "@taskdesk/ui";
import {
  Ellipsis,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  addDocumentLink,
  DOCUMENT_KINDS,
  type DocumentKind,
  type DocumentLink,
  type DocumentLinkInput,
  deleteDocumentLink,
  listDocumentLinks,
  projectOverviewKeys,
  updateDocumentLink,
} from "@/fetchers/project/overview";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import useProjectPagesFeature from "@/hooks/queries/feature-flag/use-project-pages-feature";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import {
  OptionSelect,
  Panel,
  useFailureMessage,
  useRefreshOverview,
} from "./overview-shared";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;

/**
 * `/agent/projects/{key}/documents`: the register of the engagement's official documents
 * (decision of 3 Nov 2026). Each entry is a link to where the file lives, with a type, an
 * optional description and a customer-visible flag; customer-visible entries appear on the
 * portal's Project Details. Pages are staff-only and are reached from here. Writes need
 * `project:update`; deletion is a pending action.
 */
export function DocumentsPage({ projectKey }: { projectKey: string }) {
  const { t } = useTranslation("projectOverview");
  const { project, isLoading } = useProjectByKey(projectKey);
  const projectId = project?.id ?? "";
  const pagesOn = useProjectPagesFeature(projectId);
  const { canUpdateProjects } = useWorkspacePermission();
  const canUpdate = canUpdateProjects();
  const failure = useFailureMessage();
  const openPendingAction = useOpenPendingAction();
  const [editing, setEditing] = useState<DocumentLink | "new" | null>(null);
  const query = useQuery({
    queryKey: projectOverviewKeys.documentLinks(projectId),
    queryFn: () => listDocumentLinks(projectId),
    enabled: Boolean(projectId),
  });
  const remove = useMutation({
    mutationFn: (link: DocumentLink) => deleteDocumentLink(projectId, link.id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(failure(error)),
  });

  if (isLoading || (projectId && query.isLoading))
    return (
      <div
        className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4 md:p-6"
        role="status"
        aria-label={t("loading")}
      >
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  if (!project || query.isError || !query.data)
    return (
      <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
        <Alert variant="error">
          <AlertDescription>
            {project ? t("documents.loadFailed") : t("notFound")}
          </AlertDescription>
          {project ? (
            <AlertAction>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void query.refetch()}
              >
                {t("common.retry")}
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      </div>
    );

  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-6"
      data-testid="project-documents-page"
    >
      <PageTitle title={t("documents.pageTitle", { name: project.name })} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-lg">{t("documents.title")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("documents.description")}
          </p>
        </div>
        {canUpdate ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            {t("documents.add")}
          </Button>
        ) : null}
      </div>

      <Panel title={t("documents.links")} testId="project-document-links">
        {query.data.length === 0 ? (
          <Empty data-testid="project-documents-empty">
            <EmptyHeader>
              <EmptyTitle>{t("documents.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("documents.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y">
            {query.data.map((link) => (
              <DocumentRow
                key={link.id}
                link={link}
                canUpdate={canUpdate}
                onEdit={() => setEditing(link)}
                onDelete={() => remove.mutate(link)}
              />
            ))}
          </ul>
        )}
      </Panel>

      {pagesOn ? (
        <Panel title={t("documents.pages")} testId="project-documents-pages">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-muted-foreground text-sm">
              {t("documents.pagesDescription")}
            </p>
            <Button
              variant="outline"
              size="sm"
              render={
                <Link to={routes.projectPages.path} params={{ projectKey }} />
              }
            >
              <FileText aria-hidden="true" />
              {t("documents.openPages")}
            </Button>
          </div>
        </Panel>
      ) : null}

      {editing ? (
        <DocumentLinkDialog
          projectId={projectId}
          existing={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function DocumentRow({
  link,
  canUpdate,
  onEdit,
  onDelete,
}: {
  link: DocumentLink;
  canUpdate: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("projectOverview");
  // The type badge adds nothing when the title already says it ("Statement of work").
  const kindLabel = t(`documents.kinds.${link.kind}`);
  return (
    <li
      className="flex items-start gap-3 py-3"
      data-testid="project-document-row"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-w-0 items-center gap-1 font-medium text-sm underline-offset-4 hover:underline"
          >
            <span className="truncate">{link.title}</span>
            <ExternalLink
              className="size-3 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="sr-only">({t("documents.opensInNewTab")})</span>
          </a>
          {kindLabel.toLocaleLowerCase() !==
          link.title.trim().toLocaleLowerCase() ? (
            <Badge variant="outline">{kindLabel}</Badge>
          ) : null}
        </div>
        {link.description ? (
          <p className="line-clamp-2 whitespace-pre-line break-words text-muted-foreground text-sm">
            {link.description}
          </p>
        ) : null}
        <span className="truncate text-muted-foreground text-xs">
          {link.url}
        </span>
      </div>
      <Badge variant={link.customerVisible ? "info" : "outline"}>
        {link.customerVisible
          ? t("documents.customerVisible")
          : t("documents.staffOnly")}
      </Badge>
      {canUpdate ? (
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                aria-label={t("common.actionsFor", { name: link.title })}
              />
            }
          >
            <Ellipsis className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={onEdit}>
              <Pencil className="size-4" />
              {t("common.edit")}
            </MenuItem>
            <MenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" />
              {t("common.delete")}
            </MenuItem>
          </MenuPopup>
        </Menu>
      ) : null}
    </li>
  );
}

/** Matches `routes.projectPage` paths, derived from the route so the two cannot drift. */
const PROJECT_PAGE_PATH = new RegExp(
  `^${routes.projectPage.path.replace(/\$[A-Za-z]+/gu, "[^/]+")}/?$`,
  "u",
);

/** True when `value` links to a Page on this agent host, which a customer cannot open. */
export function isProjectPageLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      url.origin === window.location.origin &&
      PROJECT_PAGE_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Adds or edits one Documents entry. `existing` edits it; `initial` prefills a new entry.
 * `staffOnly` keeps a new entry staff-only and says why: used by a Page's "Add to
 * Documents", since Pages never appear in the portal and a customer cannot open them.
 * Otherwise, when the URL links to a Page, the dialog shows the same note above the
 * customer-visible switch but does not change it (staff-only by default, not forced).
 */
export function DocumentLinkDialog({
  projectId,
  existing,
  initial,
  staffOnly = false,
  onClose,
}: {
  projectId: string;
  existing?: DocumentLink;
  initial?: Partial<DocumentLinkInput>;
  staffOnly?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("projectOverview");
  const failure = useFailureMessage();
  const refresh = useRefreshOverview(projectId);
  const start = existing ?? initial;
  const [title, setTitle] = useState(start?.title ?? "");
  const [url, setUrl] = useState(start?.url ?? "");
  const [kind, setKind] = useState<DocumentKind>(start?.kind ?? "other");
  const [description, setDescription] = useState(start?.description ?? "");
  const [customerVisible, setCustomerVisible] = useState(
    staffOnly ? false : (start?.customerVisible ?? false),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const urlValid = /^https?:\/\/\S+$/iu.test(url.trim());
  const pageLink = isProjectPageLink(url);
  const kindOptions = DOCUMENT_KINDS.map((value) => ({
    value,
    label: t(`documents.kinds.${value}`),
  }));
  const save = useMutation({
    mutationFn: () => {
      const input: DocumentLinkInput = {
        title: title.trim(),
        url: url.trim(),
        kind,
        description: description.trim() ? description.trim() : null,
        customerVisible,
      };
      return existing
        ? updateDocumentLink(projectId, existing.id, input)
        : addDocumentLink(projectId, input);
    },
    onSuccess: async () => {
      await refresh();
      toast.success(existing ? t("documents.updated") : t("documents.saved"));
      onClose();
    },
    onError: (error) => setProblem(failure(error)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-w-md" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {existing ? t("documents.editTitle") : t("documents.addTitle")}
          </DialogTitle>
          <DialogDescription>{t("documents.addDescription")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-title">{t("documents.fieldTitle")}</Label>
            <Input
              id="document-title"
              value={title}
              maxLength={TITLE_MAX}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-url">{t("documents.fieldUrl")}</Label>
            <Input
              id="document-url"
              inputMode="url"
              value={url}
              placeholder="https://"
              aria-invalid={url !== "" && !urlValid ? true : undefined}
              aria-describedby="document-url-hint"
              onChange={(event) => setUrl(event.target.value)}
            />
            {url !== "" && !urlValid ? (
              <p
                id="document-url-hint"
                className="text-destructive-foreground text-xs"
                role="alert"
              >
                {t("documents.urlInvalid")}
              </p>
            ) : (
              <p
                id="document-url-hint"
                className="text-muted-foreground text-xs"
              >
                {t("documents.urlHint")}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-kind">{t("documents.fieldKind")}</Label>
            <OptionSelect
              id="document-kind"
              value={kind}
              options={kindOptions}
              onChange={setKind}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-description">
              {t("documents.fieldDescription")}
            </Label>
            <Textarea
              id="document-description"
              value={description}
              maxLength={DESCRIPTION_MAX}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {staffOnly ? (
            <Alert variant="info" data-testid="document-staff-only-note">
              <AlertDescription>
                {t("documents.pageStaffOnly")}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {pageLink ? (
                <Alert
                  id="document-page-link-note"
                  variant="info"
                  data-testid="document-page-link-note"
                >
                  <AlertDescription>
                    {t("documents.pageStaffOnly")}
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="document-customer-visible">
                    {t("documents.fieldCustomerVisible")}
                  </Label>
                  <p
                    id="document-customer-visible-hint"
                    className="text-muted-foreground text-xs"
                  >
                    {t("documents.customerVisibleHint")}
                  </p>
                </div>
                <Switch
                  id="document-customer-visible"
                  aria-describedby={
                    pageLink
                      ? "document-customer-visible-hint document-page-link-note"
                      : "document-customer-visible-hint"
                  }
                  checked={customerVisible}
                  onCheckedChange={setCustomerVisible}
                />
              </div>
            </>
          )}
          {problem ? (
            <Alert variant="error">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!title.trim() || !urlValid || save.isPending}
            onClick={() => {
              setProblem(null);
              save.mutate();
            }}
          >
            {existing ? t("common.save") : t("documents.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
