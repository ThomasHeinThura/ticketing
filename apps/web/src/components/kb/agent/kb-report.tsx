import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { updateKbSettings } from "@/fetchers/kb";
import { kbKeys, useKbReport } from "@/hooks/queries/kb";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import { formatKbDate } from "../kb-badges";

/**
 * The deflection report (KB-10), articles that are read but do not help (KB-17), reviews that
 * are overdue (KB-7), and the workspace's review-step switch (KB-4).
 */
export function KbReport({
  workspaceId,
  canManageSettings,
  reviewStepEnabled,
}: {
  workspaceId: string;
  canManageSettings: boolean;
  reviewStepEnabled: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const report = useKbReport(workspaceId);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateKbSettings(workspaceId, enabled),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: kbKeys.settings(workspaceId) }),
    onError: (error) => toast.error(error.message),
  });
  if (report.isLoading) return <Skeleton className="h-40 w-full" />;
  if (report.isError || !report.data)
    return (
      <Alert variant="error">
        <AlertDescription>{t("kb:report.loadError")}</AlertDescription>
      </Alert>
    );
  const { deflection, overdue, unhelpful } = report.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("kb:report.deflectionTitle")}</CardTitle>
          <CardDescription>
            {t("kb:report.deflectionDescription", {
              days: deflection.windowDays,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            {t("kb:report.deflectionTotals", {
              deflected: deflection.deflected,
              candidates: deflection.candidates,
            })}
          </p>
          {deflection.articles.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("kb:report.deflectionEmpty")}
            </p>
          ) : (
            <ul className="divide-y">
              {deflection.articles.map((article) => (
                <li
                  key={article.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <Link
                    className="truncate underline-offset-4 hover:underline"
                    to={routes.kbArticle.path}
                    params={{ id: article.id }}
                  >
                    {article.title}
                  </Link>
                  <Badge variant="success">
                    {t("kb:report.deflectedOf", {
                      deflected: article.deflected,
                      candidates: article.candidates,
                    })}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("kb:report.unhelpfulTitle")}</CardTitle>
          <CardDescription>
            {t("kb:report.unhelpfulDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unhelpful.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("kb:report.unhelpfulEmpty")}
            </p>
          ) : (
            <ul className="divide-y">
              {unhelpful.map((article) => (
                <li
                  key={article.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <Link
                    className="truncate underline-offset-4 hover:underline"
                    to={routes.kbArticle.path}
                    params={{ id: article.id }}
                    search={{ tab: "feedback" }}
                  >
                    {article.title}
                  </Link>
                  <span className="shrink-0 text-muted-foreground">
                    {t("kb:report.helpfulCounts", {
                      helpful: article.helpful,
                      notHelpful: article.notHelpful,
                      views: article.viewCount,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("kb:report.overdueTitle")}</CardTitle>
          <CardDescription>{t("kb:report.overdueDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {overdue.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("kb:report.overdueEmpty")}
            </p>
          ) : (
            <ul className="divide-y">
              {overdue.map((article) => (
                <li
                  key={article.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <Link
                    className="truncate underline-offset-4 hover:underline"
                    to={routes.kbArticle.path}
                    params={{ id: article.id }}
                  >
                    {article.title}
                  </Link>
                  <span className="shrink-0 text-muted-foreground">
                    {article.ownerName ?? ""}{" "}
                    {formatKbDate(article.reviewDueAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {canManageSettings ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("kb:report.reviewStepTitle")}</CardTitle>
            <CardDescription>
              {t("kb:report.reviewStepDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Switch
              id="kb-review-step"
              checked={reviewStepEnabled}
              disabled={toggle.isPending}
              onCheckedChange={(checked) => toggle.mutate(checked)}
            />
            <Label htmlFor="kb-review-step">
              {t("kb:report.reviewStepLabel")}
            </Label>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
