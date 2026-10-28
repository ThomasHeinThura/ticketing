import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@taskdesk/ui";
import { Lightbulb } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  abandonPortalKbCandidate,
  getPortalKbSuggestions,
  recordPortalKbCandidate,
} from "@/fetchers/kb/portal";
import { routes } from "@/lib/routes";

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 350;

/**
 * KB-10 on the portal request form. Opening a suggested article records a deflection
 * candidate; if the customer then leaves the form without submitting, each recorded
 * candidate is reported abandoned (a deflection). Leaving is reported with `keepalive`, so it
 * survives a closed tab. Nothing here asks the customer anything or blocks the form (KB-11).
 */
export function usePortalKbDeflection(requestTypeKey: string | undefined) {
  const candidates = useRef<Set<string>>(new Set());
  const abandon = useCallback(() => {
    for (const id of candidates.current)
      void abandonPortalKbCandidate(id).catch(() => undefined);
    candidates.current.clear();
  }, []);
  // Leaving the form (another request type, another page, a closed tab) abandons it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key only restarts the scope
  useEffect(() => {
    window.addEventListener("pagehide", abandon);
    return () => {
      window.removeEventListener("pagehide", abandon);
      abandon();
    };
  }, [requestTypeKey, abandon]);
  return {
    recordOpened: useCallback(
      (articleId: string, query: string) => {
        void recordPortalKbCandidate({
          articleId,
          requestTypeKey,
          query,
        })
          .then((result) => {
            candidates.current.add(result.id);
          })
          .catch(() => undefined);
      },
      [requestTypeKey],
    ),
    /** The request was submitted: nothing was deflected. */
    markSubmitted: useCallback(() => {
      candidates.current.clear();
    }, []),
  };
}

/** KB-8: matching published articles, offered inline while the summary is typed. */
export function PortalKbSuggestions({
  query,
  scope,
  onOpen,
}: {
  query: string;
  /** Keeps another customer's cached suggestions apart. */
  scope: string;
  onOpen: (articleId: string, query: string) => void;
}) {
  const { t } = useTranslation();
  const [settled, setSettled] = useState(query.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const suggestions = useQuery({
    queryKey: ["portal", scope, "kb-suggestions", settled],
    queryFn: () => getPortalKbSuggestions(settled),
    enabled: settled.length >= MIN_QUERY_LENGTH,
    staleTime: 30_000,
    retry: false,
  });
  const articles =
    settled.length >= MIN_QUERY_LENGTH
      ? (suggestions.data?.articles ?? [])
      : [];
  if (articles.length === 0) return null;
  return (
    <Card aria-label={t("kb:portal.suggestionsTitle")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lightbulb className="size-4" aria-hidden="true" />
          {t("kb:portal.suggestionsTitle")}
        </CardTitle>
        <CardDescription>
          {t("kb:portal.suggestionsDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {articles.map((article) => (
            <li key={article.id}>
              {/* A new tab keeps the half-written request open; the form is never interrupted. */}
              <a
                className="font-medium underline-offset-4 hover:underline"
                href={routes.portalKbArticle.build({ id: article.id })}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onOpen(article.id, settled)}
                onAuxClick={() => onOpen(article.id, settled)}
              >
                {article.title}
              </a>
              {article.snippet ? (
                <p className="text-muted-foreground text-xs">
                  {article.snippet}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
