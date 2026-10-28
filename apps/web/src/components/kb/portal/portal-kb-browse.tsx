import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardDescription,
  CardFrame,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getPortalKb,
  getPortalKbCategories,
  type PortalKbCategory,
} from "@/fetchers/kb/portal";
import { type PortalKbSearch, routes } from "@/lib/routes";

function flatten(categories: PortalKbCategory[]) {
  const children = new Map<string | null, PortalKbCategory[]>();
  for (const category of categories) {
    const list = children.get(category.parentId) ?? [];
    list.push(category);
    children.set(category.parentId, list);
  }
  const out: { category: PortalKbCategory; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const category of children.get(parent) ?? []) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      out.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  // A category whose parent is hidden from this customer still shows, at the top.
  const known = new Set(categories.map((category) => category.id));
  for (const category of categories)
    if (category.parentId && !known.has(category.parentId))
      children.set(null, [...(children.get(null) ?? []), category]);
  walk(null, 0);
  return out;
}

/** KB-13, KB-14, KB-16: search, browse by category, most viewed and recently published. */
export function PortalKbBrowse({
  search,
  scope,
}: {
  search: PortalKbSearch;
  /** The signed-in customer, so cached results never cross customers. */
  scope: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState(search.q ?? "");
  const [sort, setSort] = useState<"recent" | "popular">("recent");
  const go = (next: PortalKbSearch) =>
    void navigate({ to: routes.portalKb.path, search: next, replace: true });
  useEffect(() => {
    if ((search.q ?? "") === text.trim()) return;
    const timer = setTimeout(
      () =>
        void navigate({
          to: routes.portalKb.path,
          search: { ...search, q: text.trim() || undefined },
          replace: true,
        }),
      300,
    );
    return () => clearTimeout(timer);
  }, [text, search, navigate]);
  const categories = useQuery({
    queryKey: ["portal", scope, "kb-categories"],
    queryFn: getPortalKbCategories,
  });
  const articles = useQuery({
    queryKey: ["portal", scope, "kb", search.q, search.category, sort],
    queryFn: () =>
      getPortalKb({
        q: search.q,
        categoryId: search.category,
        sort,
        limit: 50,
      }),
  });
  const tree = flatten(categories.data?.categories ?? []);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl">{t("kb:portal.title")}</h1>
        <p className="text-muted-foreground">{t("kb:portal.description")}</p>
      </header>
      <div className="space-y-1">
        <Label htmlFor="portal-kb-search">{t("kb:portal.search")}</Label>
        <Input
          id="portal-kb-search"
          type="search"
          value={text}
          placeholder={t("kb:portal.searchPlaceholder")}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
        <nav
          aria-label={t("kb:portal.categories")}
          className="flex flex-col gap-1"
        >
          <Button
            variant={search.category ? "ghost" : "secondary"}
            className="justify-start"
            onClick={() => go({ q: search.q })}
          >
            {t("kb:portal.allCategories")}
          </Button>
          {tree.map(({ category, depth }) => (
            <Button
              key={category.id}
              variant={search.category === category.id ? "secondary" : "ghost"}
              className="justify-start"
              style={{ marginInlineStart: `${depth * 12}px` }}
              onClick={() => go({ q: search.q, category: category.id })}
            >
              {category.name}
            </Button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          {search.q ? null : (
            <Tabs
              value={sort}
              onValueChange={(value) =>
                setSort(value === "popular" ? "popular" : "recent")
              }
            >
              <TabsList className="bg-sidebar gap-2">
                <TabsTrigger value="recent">
                  {t("kb:portal.recent")}
                </TabsTrigger>
                <TabsTrigger value="popular">
                  {t("kb:portal.popular")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {articles.isLoading ? (
            <div
              role="status"
              aria-label={t("kb:portal.loading")}
              className="space-y-3"
            >
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : articles.isError ? (
            <Alert variant="error">
              <AlertDescription>
                {t("kb:portal.loadError")}
                <Button
                  className="mt-2 w-fit"
                  onClick={() => void articles.refetch()}
                >
                  {t("common:actions.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : articles.data?.articles.length ? (
            <CardFrame>
              {articles.data.articles.map((article) => (
                <Card key={article.id}>
                  <CardHeader>
                    <CardTitle>
                      <Link
                        className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        to={routes.portalKbArticle.path}
                        params={{ id: article.id }}
                      >
                        {article.title}
                      </Link>
                    </CardTitle>
                    {article.snippet ? (
                      <CardDescription>{article.snippet}</CardDescription>
                    ) : null}
                  </CardHeader>
                </Card>
              ))}
            </CardFrame>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {search.q || search.category
                    ? t("kb:portal.noMatchTitle")
                    : t("kb:portal.emptyTitle")}
                </EmptyTitle>
                <EmptyDescription>
                  {search.q || search.category
                    ? t("kb:portal.noMatchDescription")
                    : t("kb:portal.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    </main>
  );
}
