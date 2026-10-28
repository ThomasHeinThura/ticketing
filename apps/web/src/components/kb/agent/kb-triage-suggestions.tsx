import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getKbSuggestions } from "@/fetchers/kb";
import { routes } from "@/lib/routes";
import { KbVisibilityBadge } from "../kb-badges";

/**
 * KB-12: while triaging, staff see the same suggestions the customer was offered, so an
 * article can be linked in a reply instead of re-typed. A link is only offered for an article
 * the customer can read (published and customer visible) and when the portal address is known.
 * Hidden entirely when the knowledge base is off or nothing matches.
 */
export function KbTriageSuggestions({
  workspaceId,
  text,
  onInsert,
}: {
  workspaceId: string;
  text: string;
  /** Appends a line to the reply being written. */
  onInsert: (line: string) => void;
}) {
  const { t } = useTranslation();
  const [settled, setSettled] = useState(text.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const suggestions = useQuery({
    queryKey: ["kb", workspaceId, "triage-suggestions", settled],
    queryFn: () => getKbSuggestions(workspaceId, settled),
    enabled: Boolean(workspaceId) && settled.length >= 3,
    retry: false,
    staleTime: 30_000,
  });
  const articles = suggestions.data?.articles ?? [];
  if (articles.length === 0) return null;
  const base = suggestions.data?.portalBaseUrl ?? null;
  return (
    <Card aria-label={t("kb:triage.title")}>
      <CardHeader>
        <CardTitle className="text-sm">{t("kb:triage.title")}</CardTitle>
        <CardDescription>{t("kb:triage.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {articles.map((article) => (
            <li
              key={article.id}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Link
                  className="truncate font-medium text-sm underline-offset-4 hover:underline"
                  to={routes.kbArticle.path}
                  params={{ id: article.id }}
                >
                  {article.title}
                </Link>
                <KbVisibilityBadge customerVisible={article.customerVisible} />
              </span>
              {article.customerVisible && base ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onInsert(
                      `${article.title}: ${base}${routes.portalKbArticle.build({ id: article.id })}`,
                    )
                  }
                >
                  {t("kb:triage.insert")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
