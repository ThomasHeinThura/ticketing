import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@taskdesk/ui";
import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { createKbArticle } from "@/fetchers/kb";
import {
  kbKeys,
  useKbArticles,
  useKbCategories,
  useKbSettings,
} from "@/hooks/queries/kb";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import {
  KB_LIST_VIEWS,
  KB_STATES,
  type KbListSearch,
  routes,
} from "@/lib/routes";
import { formatKbDate, KbStateBadge, KbVisibilityBadge } from "../kb-badges";
import { KbCategories } from "./kb-categories";
import { KbReport } from "./kb-report";

const PAGE_SIZE = 25;
const ALL = "all";

function NewArticleDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const mutation = useMutation({
    mutationFn: () => createKbArticle(workspaceId, { title: title.trim() }),
    onSuccess: async (article) => {
      await queryClient.invalidateQueries({
        queryKey: kbKeys.all(workspaceId),
      });
      onClose();
      void navigate({
        to: routes.kbArticleEdit.path,
        params: { id: article.id },
      });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("kb:create.title")}</DialogTitle>
          <DialogDescription>{t("kb:create.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() && !mutation.isPending) mutation.mutate();
          }}
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="kb-new-title">{t("kb:fields.title")}</Label>
              <Input
                id="kb-new-title"
                autoFocus
                required
                maxLength={200}
                value={title}
                disabled={mutation.isPending}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            {mutation.error ? (
              <Alert variant="error">
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !title.trim()}
            >
              {t("kb:create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArticlesView({
  workspaceId,
  search,
  onSearchChange,
}: {
  workspaceId: string;
  search: KbListSearch;
  onSearchChange: (next: KbListSearch) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(search.q ?? "");
  const [page, setPage] = useState(0);
  // The URL follows the box after a short pause, so a shared link shows the same list.
  useEffect(() => {
    if ((search.q ?? "") === text.trim()) return;
    const timer = setTimeout(() => {
      setPage(0);
      onSearchChange({ ...search, q: text.trim() || undefined });
    }, 300);
    return () => clearTimeout(timer);
  }, [text, search, onSearchChange]);
  const categories = useKbCategories(workspaceId);
  const articles = useKbArticles({
    workspaceId,
    q: search.q,
    state: search.state,
    categoryId: search.category,
    overdue: search.overdue,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const total = articles.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1">
          <Label htmlFor="kb-search">{t("kb:list.search")}</Label>
          <Input
            id="kb-search"
            type="search"
            value={text}
            placeholder={t("kb:list.searchPlaceholder")}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="kb-filter-state">{t("kb:fields.status")}</Label>
          <Select
            value={search.state ?? ALL}
            onValueChange={(value) => {
              setPage(0);
              onSearchChange({
                ...search,
                state: KB_STATES.find((state) => state === value) ?? undefined,
              });
            }}
          >
            <SelectTrigger id="kb-filter-state" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("kb:list.allStates")}</SelectItem>
              {KB_STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {t(`kb:state.${state}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="kb-filter-category">{t("kb:fields.category")}</Label>
          <Select
            value={search.category ?? ALL}
            onValueChange={(value) => {
              setPage(0);
              onSearchChange({
                ...search,
                category: value && value !== ALL ? value : undefined,
              });
            }}
          >
            <SelectTrigger id="kb-filter-category" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("kb:list.allCategories")}</SelectItem>
              {(categories.data?.categories ?? []).map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch
            id="kb-filter-overdue"
            checked={search.overdue === true}
            onCheckedChange={(checked) => {
              setPage(0);
              onSearchChange({ ...search, overdue: checked || undefined });
            }}
          />
          <Label htmlFor="kb-filter-overdue">{t("kb:list.overdueOnly")}</Label>
        </div>
      </div>
      {articles.isLoading ? (
        <div
          role="status"
          aria-label={t("kb:list.loading")}
          className="space-y-3"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : articles.isError ? (
        <Alert variant="error">
          <AlertTitle>{t("kb:list.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("kb:list.loadErrorDescription")}
            <Button className="w-fit" onClick={() => void articles.refetch()}>
              <RefreshCw aria-hidden="true" />
              {t("common:actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : articles.data?.articles.length ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("kb:fields.title")}</TableHead>
                <TableHead>{t("kb:fields.status")}</TableHead>
                <TableHead>{t("kb:fields.visibility")}</TableHead>
                <TableHead>{t("kb:fields.owner")}</TableHead>
                <TableHead>{t("kb:fields.reviewDue")}</TableHead>
                <TableHead>{t("kb:fields.views")}</TableHead>
                <TableHead>{t("kb:fields.updated")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articles.data.articles.map((article) => (
                <TableRow key={article.id}>
                  <TableCell className="max-w-96">
                    <Link
                      className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      to={routes.kbArticle.path}
                      params={{ id: article.id }}
                    >
                      {article.title}
                    </Link>
                    {article.snippet ? (
                      <p className="truncate text-muted-foreground text-xs">
                        {article.snippet}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <KbStateBadge state={article.state} />
                  </TableCell>
                  <TableCell>
                    <KbVisibilityBadge
                      customerVisible={article.customerVisible}
                    />
                  </TableCell>
                  <TableCell>{article.ownerName ?? ""}</TableCell>
                  <TableCell>
                    {formatKbDate(article.reviewDueAt)}
                    {article.overdue ? (
                      <Badge className="ms-2" variant="error">
                        {t("kb:list.overdue")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{article.viewCount}</TableCell>
                  <TableCell>{formatKbDate(article.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {total > PAGE_SIZE ? (
            <div className="flex items-center justify-between text-muted-foreground text-sm">
              <span>
                {t("kb:list.page", { page: page + 1, pages: lastPage + 1 })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  {t("common:actions.previous", { defaultValue: "Previous" })}
                </Button>
                <Button
                  variant="outline"
                  disabled={page >= lastPage}
                  onClick={() =>
                    setPage((current) => Math.min(lastPage, current + 1))
                  }
                >
                  {t("common:actions.next", { defaultValue: "Next" })}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("kb:list.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("kb:list.emptyDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}

/** `docs/screens.md` "Knowledge base list": articles, category tree and the deflection report. */
export function KbList({
  search,
  onSearchChange,
}: {
  search: KbListSearch;
  onSearchChange: (next: KbListSearch) => void;
}) {
  const { t } = useTranslation();
  const { data: workspace, isLoading } = useActiveWorkspace();
  const settings = useKbSettings(workspace?.id ?? "");
  const [creating, setCreating] = useState(false);
  const view = search.view ?? "articles";
  const canWrite = settings.data?.canWrite === true;
  return (
    <>
      <PageTitle title={t("kb:list.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{t("kb:list.title")}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("kb:list.description")}
            </p>
          </div>
          {canWrite ? (
            <Button onClick={() => setCreating(true)} disabled={!workspace}>
              <Plus aria-hidden="true" />
              {t("kb:list.new")}
            </Button>
          ) : null}
        </div>
        <Tabs
          value={view}
          onValueChange={(value) => {
            const next = KB_LIST_VIEWS.find((candidate) => candidate === value);
            onSearchChange({ ...search, view: next });
          }}
        >
          <TabsList className="bg-sidebar gap-2">
            {KB_LIST_VIEWS.map((candidate) => (
              <TabsTrigger key={candidate} value={candidate}>
                {t(`kb:views.${candidate}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {isLoading || !workspace ? (
          <Skeleton className="h-24 w-full" />
        ) : view === "articles" ? (
          <ArticlesView
            workspaceId={workspace.id}
            search={search}
            onSearchChange={onSearchChange}
          />
        ) : view === "categories" ? (
          <KbCategories
            workspaceId={workspace.id}
            canManage={settings.data?.canPublish === true}
            onOpenCategory={(category) =>
              onSearchChange({ category, view: undefined })
            }
          />
        ) : (
          <KbReport
            workspaceId={workspace.id}
            canManageSettings={settings.data?.canManageSettings === true}
            reviewStepEnabled={settings.data?.reviewStepEnabled === true}
          />
        )}
      </div>
      {creating && workspace ? (
        <NewArticleDialog
          workspaceId={workspace.id}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
