import { createFileRoute, Link } from "@tanstack/react-router";
import { apiFetch } from "@taskdesk/libs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiUrl } from "@/fetchers/get-api-url";

export const Route = createFileRoute("/submissions")({
  component: SubmissionList,
});

type Submission = {
  ref: string;
  state: string;
  workItemKey: string | null;
  createdAt: string;
  requestTypeName: string;
};

function SubmissionList() {
  const { t } = useTranslation("portal");
  const [items, setItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await apiFetch(getApiUrl("portal/submissions"), {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("submissions unavailable");
      const body = (await response.json()) as { items: Submission[] };
      setItems(body.items);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-6 bg-background p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">{t("submissions.title")}</h1>
          <p className="text-muted-foreground">
            {t("submissions.description")}
          </p>
        </header>
        <Button variant="outline" render={<Link to="/" />}>
          {t("submissions.catalogue")}
        </Button>
      </div>

      {loading ? (
        <div
          role="status"
          aria-label={t("submissions.loading")}
          className="space-y-3"
        >
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : failed ? (
        <Alert variant="error">
          <AlertTitle>{t("submissions.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("submissions.loadErrorDescription")}
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void load()}
            >
              {t("submissions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <Card>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("submissions.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("submissions.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
              <Button render={<Link to="/" />}>
                {t("submissions.browseCatalogue")}
              </Button>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3" aria-label={t("submissions.label")}>
          {items.map((item) => (
            <li key={item.ref}>
              <Link
                className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                to="/submissions/$ref"
                params={{ ref: item.ref }}
              >
                <Card className="transition-colors hover:bg-muted/40">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <h2 className="font-medium">{item.requestTypeName}</h2>
                      <p className="text-sm text-muted-foreground">
                        {item.ref} ·{" "}
                        {new Date(item.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <p className="text-sm capitalize">
                      {t(`state.${item.state}`)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
