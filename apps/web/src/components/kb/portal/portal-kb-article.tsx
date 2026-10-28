import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getPortalKbArticle,
  type PortalKbArticle,
  sendPortalKbFeedback,
} from "@/fetchers/kb/portal";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import { KbArticleContent, KbTableOfContents } from "../kb-article-content";

/** KB-17: "Was this helpful?", a yes or no with an optional comment. Never required. */
function Helpfulness({
  article,
  scope,
}: {
  article: PortalKbArticle;
  scope: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState<boolean | null>(
    article.myFeedback?.helpful ?? null,
  );
  const [comment, setComment] = useState(article.myFeedback?.comment ?? "");
  const [sent, setSent] = useState(Boolean(article.myFeedback));
  const send = useMutation({
    mutationFn: (input: { helpful: boolean; comment?: string }) =>
      sendPortalKbFeedback(article.id, input),
    onSuccess: async () => {
      setSent(true);
      await queryClient.invalidateQueries({
        queryKey: ["portal", scope, "kb-article", article.id],
      });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("kb:portal.helpfulTitle")}</CardTitle>
        <CardDescription>
          {sent ? t("kb:portal.helpfulThanks") : t("kb:portal.helpfulPrompt")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button
            variant={answer === true ? "secondary" : "outline"}
            aria-pressed={answer === true}
            disabled={send.isPending}
            onClick={() => {
              setAnswer(true);
              send.mutate({ helpful: true });
            }}
          >
            {t("kb:portal.yes")}
          </Button>
          <Button
            variant={answer === false ? "secondary" : "outline"}
            aria-pressed={answer === false}
            disabled={send.isPending}
            onClick={() => {
              setAnswer(false);
              send.mutate({ helpful: false });
            }}
          >
            {t("kb:portal.no")}
          </Button>
        </div>
        {answer !== null ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              send.mutate({
                helpful: answer,
                comment: comment.trim() || undefined,
              });
            }}
          >
            <Textarea
              aria-label={t("kb:portal.commentLabel")}
              placeholder={t("kb:portal.commentPlaceholder")}
              maxLength={2000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={send.isPending}>
              {t("kb:portal.sendComment")}
            </Button>
          </form>
        ) : null}
        {send.isError ? (
          <Alert variant="error">
            <AlertDescription>{t("kb:portal.feedbackError")}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The portal article page: the published version, a table of contents and related articles. */
export function PortalKbArticleView({
  id,
  scope,
}: {
  id: string;
  scope: string;
}) {
  const { t } = useTranslation();
  const article = useQuery({
    queryKey: ["portal", scope, "kb-article", id],
    queryFn: () => getPortalKbArticle(id),
    retry: false,
  });
  if (article.isLoading)
    return (
      <main className="mx-auto w-full max-w-3xl p-6">
        <Skeleton className="h-40 w-full" />
      </main>
    );
  if (article.isError || !article.data) {
    const missing =
      article.error instanceof HttpError && article.error.status === 404;
    return (
      <main className="mx-auto w-full max-w-3xl p-6">
        <Alert variant="error">
          <AlertTitle>
            {missing
              ? t("kb:portal.notFoundTitle")
              : t("kb:portal.loadErrorTitle")}
          </AlertTitle>
          <AlertDescription>
            {missing
              ? t("kb:portal.notFoundDescription")
              : t("kb:portal.loadError")}
            <Button
              className="mt-2 w-fit"
              variant="outline"
              render={<Link to={routes.portalKb.path} />}
            >
              {t("kb:portal.backToKb")}
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    );
  }
  const data = article.data;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <Button
        variant="ghost"
        className="w-fit"
        render={<Link to={routes.portalKb.path} />}
      >
        ← {t("kb:portal.backToKb")}
      </Button>
      <header className="space-y-2">
        <h1 className="font-semibold text-2xl">{data.title}</h1>
        {data.categoryName ? (
          <Badge variant="outline">{data.categoryName}</Badge>
        ) : null}
      </header>
      <KbTableOfContents body={data.body} label={t("kb:portal.toc")} />
      <KbArticleContent body={data.body} />
      <Helpfulness article={data} scope={scope} />
      {data.related.length > 0 ? (
        <section className="space-y-2" aria-labelledby="portal-kb-related">
          <h2 id="portal-kb-related" className="font-medium text-sm">
            {t("kb:portal.related")}
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {data.related.map((entry) => (
              <li key={entry.id}>
                <Link
                  className="underline-offset-4 hover:underline"
                  to={routes.portalKbArticle.path}
                  params={{ id: entry.id }}
                >
                  {entry.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
