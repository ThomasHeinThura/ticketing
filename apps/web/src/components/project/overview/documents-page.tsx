import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
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
  Input,
  Label,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import { Ellipsis, ExternalLink, FileText, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  addDocumentLink,
  type DocumentLink,
  deleteDocumentLink,
  listDocumentLinks,
  projectOverviewKeys,
} from "@/fetchers/project/overview";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import useProjectPagesFeature from "@/hooks/queries/feature-flag/use-project-pages-feature";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import {
  Panel,
  useFailureMessage,
  useRefreshOverview,
} from "./overview-shared";

/**
 * `/agent/projects/{key}/documents`: links to documents kept elsewhere, each staff-only or
 * visible to the customer, and a way into the project's Pages. Writes need `project:update`.
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
  const [adding, setAdding] = useState(false);
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
        <div>
          <h1 className="font-semibold text-lg">{t("documents.title")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("documents.description")}
          </p>
        </div>
        {canUpdate ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            {t("documents.add")}
          </Button>
        ) : null}
      </div>

      <Panel title={t("documents.links")} testId="project-document-links">
        {query.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("documents.empty")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {query.data.map((link) => (
              <li
                key={link.id}
                className="flex items-center gap-3 py-2"
                data-testid="project-document-row"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-w-0 items-center gap-1 text-sm underline-offset-4 hover:underline"
                  >
                    <span className="truncate">{link.title}</span>
                    <ExternalLink
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </a>
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
                          aria-label={t("common.actionsFor", {
                            name: link.title,
                          })}
                        />
                      }
                    >
                      <Ellipsis className="size-4" />
                    </MenuTrigger>
                    <MenuPopup align="end">
                      <MenuItem
                        variant="destructive"
                        onClick={() => remove.mutate(link)}
                      >
                        <Trash2 className="size-4" />
                        {t("common.delete")}
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {pagesOn ? (
        <Panel title={t("documents.pages")} testId="project-documents-pages">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
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

      {adding ? (
        <DocumentLinkDialog
          projectId={projectId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

function DocumentLinkDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("projectOverview");
  const failure = useFailureMessage();
  const refresh = useRefreshOverview(projectId);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [customerVisible, setCustomerVisible] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const urlValid = /^https?:\/\/\S+$/iu.test(url.trim());
  const save = useMutation({
    mutationFn: () =>
      addDocumentLink(projectId, {
        title: title.trim(),
        url: url.trim(),
        customerVisible,
      }),
    onSuccess: async () => {
      await refresh();
      toast.success(t("documents.saved"));
      onClose();
    },
    onError: (error) => setProblem(failure(error)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-w-md" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("documents.addTitle")}</DialogTitle>
          <DialogDescription>{t("documents.addDescription")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-title">{t("documents.fieldTitle")}</Label>
            <Input
              id="document-title"
              value={title}
              maxLength={200}
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
              onChange={(event) => setUrl(event.target.value)}
            />
            {url !== "" && !urlValid ? (
              <p className="text-destructive-foreground text-xs" role="alert">
                {t("documents.urlInvalid")}
              </p>
            ) : null}
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="document-customer-visible">
                {t("documents.fieldCustomerVisible")}
              </Label>
              <p className="text-muted-foreground text-xs">
                {t("documents.customerVisibleHint")}
              </p>
            </div>
            <Switch
              id="document-customer-visible"
              checked={customerVisible}
              onCheckedChange={setCustomerVisible}
            />
          </div>
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
            {t("documents.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
