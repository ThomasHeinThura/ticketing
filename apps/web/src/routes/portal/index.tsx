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

export const Route = createFileRoute("/")({ component: PortalCatalogue });

type PortalCatalogueItem = {
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  group: string;
  position: number;
};

function PortalCatalogue() {
  const { t } = useTranslation("portal");
  const [items, setItems] = useState<PortalCatalogueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await apiFetch(getApiUrl("portal/catalogue"), {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("catalogue unavailable");
      const payload = (await response.json()) as {
        items: PortalCatalogueItem[];
      };
      setItems(payload.items);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = [...new Set(items.map((item) => item.group))];

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-6 bg-background p-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          {t("catalogue.eyebrow")}
        </p>
        <h1 className="text-3xl font-semibold">{t("catalogue.title")}</h1>
        <p className="max-w-2xl text-muted-foreground">
          {t("catalogue.description")}
        </p>
      </header>

      <nav aria-label={t("catalogue.label")}>
        <Button variant="outline" render={<Link to="/submissions" />}>
          {t("catalogue.myRequests")}
        </Button>
      </nav>

      {loading ? (
        <div
          className="space-y-3"
          role="status"
          aria-label={t("catalogue.loading")}
        >
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : failed ? (
        <Alert variant="error">
          <AlertTitle>{t("catalogue.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("catalogue.loadErrorDescription")}
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void load()}
            >
              {t("catalogue.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <Card>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("catalogue.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("catalogue.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section
              key={group}
              className="space-y-3"
              aria-labelledby={`group-${group}`}
            >
              <h2 id={`group-${group}`} className="text-xl font-semibold">
                {group}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {items
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <li key={item.key}>
                      <Link
                        className="block h-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        to="/catalogue/$key"
                        params={{ key: item.key }}
                      >
                        <Card className="h-full transition-colors hover:bg-muted/40">
                          <CardContent className="space-y-1 p-4">
                            <h3 className="font-medium">{item.name}</h3>
                            {item.description ? (
                              <p className="text-sm text-muted-foreground">
                                {item.description}
                              </p>
                            ) : null}
                          </CardContent>
                        </Card>
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
