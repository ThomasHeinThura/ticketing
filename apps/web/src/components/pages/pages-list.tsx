import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
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
} from "@taskdesk/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  createPage,
  getPages,
  type PageSummary,
  pageKeys,
} from "@/fetchers/pages";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import { flattenPageTree } from "./pages-tree";

const TOP_LEVEL = "none";

export function CreatePageDialog({
  projectKey,
  pages,
  initialParentId,
  onClose,
}: {
  projectKey: string;
  pages: readonly PageSummary[];
  initialParentId?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("pages");
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState<string | null>(
    initialParentId ?? null,
  );
  const create = useMutation({
    mutationFn: () => createPage(projectKey, { title: title.trim(), parentId }),
    onSuccess: async (page) => {
      await cache.invalidateQueries({ queryKey: pageKeys.all });
      onClose();
      void navigate({
        href: routes.projectPage.build({ projectKey, pageId: page.id }),
      });
    },
    onError: (error) =>
      toast.error(
        error instanceof HttpError && error.status === 422
          ? error.message
          : t("create.failed"),
      ),
  });
  const rows = flattenPageTree(pages);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !create.isPending && onClose()}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-6">
          <div className="space-y-2">
            <Label htmlFor="page-title">{t("fields.title")}</Label>
            <Input
              id="page-title"
              maxLength={200}
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="page-parent">{t("fields.parent")}</Label>
            <Select
              value={parentId ?? TOP_LEVEL}
              onValueChange={(value) =>
                setParentId(value && value !== TOP_LEVEL ? value : null)
              }
            >
              <SelectTrigger id="page-parent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TOP_LEVEL}>
                  {t("fields.topLevel")}
                </SelectItem>
                {rows.map(({ page, depth }) => (
                  <SelectItem key={page.id} value={page.id}>
                    {`${"– ".repeat(depth)}${page.title}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={create.isPending}
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={create.isPending || title.trim().length === 0}
            onClick={() => create.mutate()}
          >
            {t("create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * `docs/screens.md` "Pages" (`PG-1`): the project's pages as a tree, siblings sorted by title. Staff-only; a project the caller cannot reach answers 404.
 */
export function PagesList({ projectKey }: { projectKey: string }) {
  const { t, i18n } = useTranslation("pages");
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: pageKeys.list(projectKey),
    queryFn: () => getPages(projectKey),
    retry: (count, error) =>
      !(error instanceof HttpError && error.status < 500) && count < 2,
  });

  if (query.isLoading)
    return (
      <div
        className="mx-auto flex max-w-4xl flex-col gap-3 p-4"
        role="status"
        aria-label={t("common.loading")}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="mx-auto max-w-4xl p-4">
        <Alert variant="error">
          <AlertDescription>
            {query.error instanceof HttpError && query.error.status === 404
              ? t("list.notFound")
              : t("list.loadFailed")}
          </AlertDescription>
        </Alert>
      </div>
    );

  const { pages, canEdit } = query.data;
  const rows = flattenPageTree(pages);
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <PageTitle title={t("list.pageTitle")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-lg">{t("list.title")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("list.description")}
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("list.create")}
          </Button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <Empty data-testid="pages-empty">
          <EmptyHeader>
            <EmptyTitle>{t("list.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("list.emptyDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("list.title")}>
          {rows.map(({ page, depth }) => (
            <li key={page.id} style={{ paddingLeft: `${depth * 1.5}rem` }}>
              <Card>
                <CardContent className="flex flex-col gap-1 py-3">
                  <Link
                    to="/agent/projects/$projectKey/pages/$pageId"
                    params={{ projectKey, pageId: page.id }}
                    className="truncate font-medium hover:underline"
                  >
                    {page.title}
                  </Link>
                  {page.snippet ? (
                    <p className="line-clamp-2 text-muted-foreground text-xs">
                      {page.snippet}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    {t("list.updated", {
                      date: dates.format(new Date(page.updatedAt)),
                      name: page.updatedBy?.name ?? t("common.unknownPerson"),
                    })}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <CreatePageDialog
          projectKey={projectKey}
          pages={pages}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}
