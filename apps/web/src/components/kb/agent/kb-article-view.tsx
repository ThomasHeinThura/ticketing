import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@taskdesk/ui";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  type KbArticle,
  type KbTransition,
  KbVersionConflictError,
  restoreKbVersion,
  transitionKbArticle,
} from "@/fetchers/kb";
import {
  kbKeys,
  useKbArticle,
  useKbFeedback,
  useKbVersion,
  useKbVersions,
} from "@/hooks/queries/kb";
import { HttpError } from "@/lib/http-error";
import { KB_ARTICLE_TABS, type KbArticleSearch, routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import { KbArticleContent, KbTableOfContents } from "../kb-article-content";
import {
  formatKbDate,
  formatKbDueDate,
  KbStateBadge,
  KbVisibilityBadge,
} from "../kb-badges";
import { KbWorkItemReference } from "./kb-work-item-reference";

const renderers = {
  issueLink: ({ issueKey }: { issueKey: string }) => (
    <KbWorkItemReference issueKey={issueKey} />
  ),
};

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function VersionHistory({
  article,
  canWrite,
  selected,
  onSelect,
}: {
  article: KbArticle;
  canWrite: boolean;
  selected: number | undefined;
  onSelect: (version: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const versions = useKbVersions(article.id);
  const detail = useKbVersion(article.id, selected);
  const restore = useMutation({
    mutationFn: (number: number) =>
      restoreKbVersion(article.id, number, article.version),
    onSuccess: async () => {
      toast.success(t("kb:versions.restored"));
      await queryClient.invalidateQueries({ queryKey: ["kb"] });
    },
    onError: async (error) => {
      toast.error(error.message);
      await queryClient.invalidateQueries({ queryKey: ["kb"] });
    },
  });
  if (versions.isLoading) return <Skeleton className="h-24 w-full" />;
  if (!versions.data?.versions.length)
    return (
      <p className="text-muted-foreground text-sm">{t("kb:versions.empty")}</p>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <ul className="flex flex-col divide-y rounded-lg border">
        {versions.data.versions.map((version) => (
          <li
            key={version.number}
            className="flex items-center gap-2 px-3 py-2"
          >
            <Button
              variant={selected === version.number ? "secondary" : "ghost"}
              className="h-auto flex-1 justify-start whitespace-normal py-1 text-start"
              onClick={() => onSelect(version.number)}
            >
              <span className="flex flex-col">
                <span className="font-medium text-sm">
                  {t("kb:versions.number", { number: version.number })}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatKbDate(version.createdAt)}
                  {version.createdByName ? ` · ${version.createdByName}` : ""}
                </span>
              </span>
            </Button>
            {version.current ? (
              <Badge variant="success">{t("kb:versions.live")}</Badge>
            ) : null}
          </li>
        ))}
      </ul>
      <div>
        {selected === undefined ? (
          <p className="text-muted-foreground text-sm">
            {t("kb:versions.choose")}
          </p>
        ) : detail.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : detail.data ? (
          <Card>
            <CardHeader>
              <CardTitle>{detail.data.title}</CardTitle>
              <CardDescription>
                {t("kb:versions.number", { number: detail.data.number })} ·{" "}
                {formatKbDate(detail.data.createdAt)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <KbArticleContent body={detail.data.body} renderers={renderers} />
              {canWrite ? (
                <Button
                  variant="outline"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(detail.data.number)}
                >
                  {t("kb:versions.restore")}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Alert variant="error">
            <AlertDescription>{t("kb:versions.loadError")}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

function FeedbackTab({ articleId }: { articleId: string }) {
  const { t } = useTranslation();
  const feedback = useKbFeedback(articleId);
  if (feedback.isLoading) return <Skeleton className="h-24 w-full" />;
  if (!feedback.data)
    return (
      <Alert variant="error">
        <AlertDescription>{t("kb:feedback.loadError")}</AlertDescription>
      </Alert>
    );
  const { helpful, notHelpful, comments } = feedback.data;
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Badge variant="success">
          {t("kb:feedback.helpful", { count: helpful })}
        </Badge>
        <Badge variant="error">
          {t("kb:feedback.notHelpful", { count: notHelpful })}
        </Badge>
      </div>
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("kb:feedback.noComments")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {comments.map((entry) => (
            <li
              key={`${entry.createdAt}-${entry.comment}`}
              className="space-y-1 px-4 py-3"
            >
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Badge variant={entry.helpful ? "success" : "error"}>
                  {entry.helpful
                    ? t("kb:feedback.answerHelpful")
                    : t("kb:feedback.answerNotHelpful")}
                </Badge>
                {formatKbDate(entry.createdAt)}
              </div>
              <p className="text-sm">{entry.comment}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** `docs/screens.md` "Article view": the article, its version history and its feedback. */
export function KbArticleView({
  id,
  search,
  onSearchChange,
}: {
  id: string;
  search: KbArticleSearch;
  onSearchChange: (next: KbArticleSearch) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const detail = useKbArticle(id);
  const transition = useMutation({
    mutationFn: ({
      action,
      version,
    }: {
      action: KbTransition;
      version: number;
    }) => transitionKbArticle(id, version, action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["kb"] });
    },
    onError: async (error) => {
      toast.error(
        error instanceof KbVersionConflictError
          ? t("kb:article.conflict")
          : error.message,
      );
      await queryClient.invalidateQueries({ queryKey: kbKeys.article(id) });
    },
  });
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
            {missing ? null : (
              <Button className="w-fit" onClick={() => void detail.refetch()}>
                <RefreshCw aria-hidden="true" />
                {t("common:actions.retry")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  const { article, related, canPublish, canWrite, reviewStepEnabled } =
    detail.data;
  const tab = search.tab ?? "article";
  const run = (action: KbTransition) =>
    transition.mutate({ action, version: article.version });
  const busy = transition.isPending;
  return (
    <>
      <PageTitle title={article.title} />
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
              <BreadcrumbPage>{article.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{article.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <KbStateBadge state={article.state} />
              <KbVisibilityBadge customerVisible={article.customerVisible} />
              {article.overdue ? (
                <Badge variant="error">{t("kb:list.overdue")}</Badge>
              ) : null}
              {article.hasUnpublishedChanges ? (
                <Badge variant="warning">
                  {t("kb:article.unpublishedChanges")}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canWrite && article.state !== "archived" ? (
              <Button
                variant="outline"
                render={
                  <Link
                    to={routes.kbArticleEdit.path}
                    params={{ id: article.id }}
                  />
                }
              >
                {t("kb:article.edit")}
              </Button>
            ) : null}
            {canWrite &&
            reviewStepEnabled &&
            (article.state === "draft" || article.state === "archived") ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run("submit")}
              >
                {t("kb:article.submit")}
              </Button>
            ) : null}
            {canPublish &&
            (article.state === "in_review" ||
              (article.state === "draft" && !reviewStepEnabled) ||
              (article.state === "published" &&
                article.hasUnpublishedChanges)) ? (
              <Button disabled={busy} onClick={() => run("publish")}>
                {article.state === "published"
                  ? t("kb:article.publishChanges")
                  : t("kb:article.publish")}
              </Button>
            ) : null}
            {canPublish &&
            (article.state === "published" || article.state === "in_review") ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run("unpublish")}
              >
                {t("kb:article.unpublish")}
              </Button>
            ) : null}
            {canPublish && article.state === "archived" ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run("restore")}
              >
                {t("kb:article.restore")}
              </Button>
            ) : null}
            {canPublish && article.state !== "archived" ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run("archive")}
              >
                {t("kb:article.archive")}
              </Button>
            ) : null}
          </div>
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const next = KB_ARTICLE_TABS.find(
              (candidate) => candidate === value,
            );
            onSearchChange({ tab: next });
          }}
        >
          <TabsList className="bg-sidebar gap-2">
            {KB_ARTICLE_TABS.map((candidate) => (
              <TabsTrigger key={candidate} value={candidate}>
                {t(`kb:article.tabs.${candidate}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {tab === "article" ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
            <div className="min-w-0 space-y-4">
              <KbTableOfContents
                body={article.body}
                label={t("kb:article.toc")}
              />
              <KbArticleContent body={article.body} renderers={renderers} />
              {related.length > 0 ? (
                <section className="space-y-2" aria-labelledby="kb-related">
                  <h2 id="kb-related" className="font-medium text-sm">
                    {t("kb:article.related")}
                  </h2>
                  <ul className="flex flex-col gap-1 text-sm">
                    {related.map((entry) => (
                      <li key={entry.id}>
                        <Link
                          className="underline-offset-4 hover:underline"
                          to={routes.kbArticle.path}
                          params={{ id: entry.id }}
                        >
                          {entry.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
            <dl className="flex flex-col gap-3 rounded-lg border p-4">
              <Meta label={t("kb:fields.category")}>
                {article.categoryName ?? t("kb:fields.none")}
              </Meta>
              <Meta label={t("kb:fields.owner")}>
                {article.ownerName ?? t("kb:fields.none")}
              </Meta>
              <Meta label={t("kb:fields.author")}>
                {article.authorName ?? t("kb:fields.none")}
              </Meta>
              <Meta label={t("kb:fields.reviewDue")}>
                {formatKbDueDate(article.reviewDueAt) || t("kb:fields.none")}
              </Meta>
              <Meta label={t("kb:fields.views")}>{article.viewCount}</Meta>
              <Meta label={t("kb:fields.liveVersion")}>
                {article.publishedVersion ?? t("kb:fields.none")}
              </Meta>
              <Meta label={t("kb:fields.updated")}>
                {formatKbDate(article.updatedAt)}
              </Meta>
            </dl>
          </div>
        ) : tab === "versions" ? (
          <VersionHistory
            article={article}
            canWrite={canWrite}
            selected={search.version}
            onSelect={(version) => onSearchChange({ tab: "versions", version })}
          />
        ) : (
          <FeedbackTab articleId={article.id} />
        )}
      </div>
    </>
  );
}
