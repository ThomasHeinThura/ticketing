import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from "@taskdesk/ui";
import { BookOpen, FileText, LayoutList, Search } from "lucide-react";
import {
  Fragment,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { getPortalCatalogue } from "@/fetchers/intake";
import { getPortalKb } from "@/fetchers/kb/portal";
import { getPortalCases } from "@/fetchers/portal/cases";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { routes } from "@/lib/routes";

const RESULTS_PER_GROUP = 5;

type Destination =
  | { to: "/kb/$id"; params: { id: string } }
  | { to: "/kb"; search: { q: string } }
  | { to: "/catalogue"; search: { q?: string; key?: string } }
  | { to: "/requests/$ref" | "/submissions/$ref"; params: { ref: string } };

export type PortalSearchEntry = {
  id: string;
  kind: "article" | "requestType" | "case" | "more";
  title: string;
  description?: string;
  destination: Destination;
};

type PortalSearchGroup = {
  value: string;
  label: string;
  items: PortalSearchEntry[];
};

function useDebounced(value: string, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const ICONS = {
  article: BookOpen,
  requestType: LayoutList,
  case: FileText,
  more: Search,
} as const;

/**
 * The top bar's "Search for help" results (Kaneo's command palette, as the agent search):
 * knowledge-base articles (`GET /api/portal/kb?q=`), request types (`GET /api/portal/catalogue`)
 * and the customer's own requests (`GET /api/portal/requests?scope=mine&q=`), each through the
 * existing portal APIs and the customer's own reach. A group that fails (the knowledge base
 * switched off, say) is left out; the others still show. The last group keeps the full article
 * search and the catalogue filter one step away.
 */
export default function PortalSearchDialog({
  open,
  onOpenChange,
  initialQuery,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = usePortalTranslation("portal");
  const navigate = useNavigate();
  const navigatedRef = useRef(false);
  const descriptionId = useId();
  const [query, setQuery] = useState(initialQuery);
  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);
  const term = useDebounced(query.trim());
  const enabled = open && term.length > 0;

  const articles = useQuery({
    queryKey: ["portal", "help-search", "kb", term],
    queryFn: () => getPortalKb({ q: term, limit: RESULTS_PER_GROUP }),
    enabled,
    retry: false,
  });
  const requestTypes = useQuery({
    queryKey: ["portal", "help-search", "catalogue", term],
    queryFn: () => getPortalCatalogue(term),
    enabled,
    retry: false,
  });
  const cases = useQuery({
    queryKey: ["portal", "help-search", "cases", term],
    queryFn: () =>
      getPortalCases({ scope: "mine", q: term, limit: RESULTS_PER_GROUP }),
    enabled,
    retry: false,
  });

  const groups: PortalSearchGroup[] = [];
  if (enabled) {
    const articleItems = (articles.data?.articles ?? [])
      .slice(0, RESULTS_PER_GROUP)
      .map(
        (article): PortalSearchEntry => ({
          id: `article:${article.id}`,
          kind: "article",
          title: article.title,
          description: article.snippet || undefined,
          destination: { to: "/kb/$id", params: { id: article.id } },
        }),
      );
    if (articleItems.length > 0)
      groups.push({
        value: "articles",
        label: t("shell.search.groups.articles"),
        items: articleItems,
      });
    const typeItems = (
      (requestTypes.data?.requestTypes ?? []) as Array<{
        key: string;
        name: string;
        description?: string | null;
      }>
    )
      .slice(0, RESULTS_PER_GROUP)
      .map(
        (type): PortalSearchEntry => ({
          id: `requestType:${type.key}`,
          kind: "requestType",
          title: type.name,
          description: type.description || undefined,
          destination: { to: "/catalogue", search: { key: type.key } },
        }),
      );
    if (typeItems.length > 0)
      groups.push({
        value: "requestTypes",
        label: t("shell.search.groups.requestTypes"),
        items: typeItems,
      });
    const caseItems = (cases.data?.cases ?? []).slice(0, RESULTS_PER_GROUP).map(
      (item): PortalSearchEntry => ({
        id: `case:${item.source}:${item.ref}`,
        kind: "case",
        title: item.title || item.requestTypeName,
        description: item.ref,
        destination: {
          to:
            item.source === "submission"
              ? routes.portalSubmission.path
              : routes.portalRequest.path,
          params: { ref: item.ref },
        },
      }),
    );
    if (caseItems.length > 0)
      groups.push({
        value: "cases",
        label: t("shell.search.groups.cases"),
        items: caseItems,
      });
    groups.push({
      value: "more",
      label: t("shell.search.groups.more"),
      items: [
        ...(articles.isError
          ? []
          : [
              {
                id: "more:kb",
                kind: "more" as const,
                title: t("shell.search.allArticles", { q: term }),
                destination: { to: "/kb" as const, search: { q: term } },
              },
            ]),
        {
          id: "more:catalogue",
          kind: "more",
          title: t("shell.search.allRequestTypes", { q: term }),
          destination: { to: "/catalogue", search: { q: term } },
        },
      ],
    });
  }
  const searching =
    enabled &&
    (articles.isFetching || requestTypes.isFetching || cases.isFetching);
  // Only the "more" group is left: say so, rather than showing two links without context.
  const noMatches = enabled && !searching && groups.length === 1;

  const choose = (entry: PortalSearchEntry) => {
    navigatedRef.current = true;
    onOpenChange(false);
    void navigate(entry.destination as never);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup
        aria-label={t("shell.search.label")}
        finalFocus={() => {
          // Choosing a result opens another page; focus then belongs to that page.
          if (navigatedRef.current) {
            navigatedRef.current = false;
            return false;
          }
          const target = returnFocusRef?.current;
          return target?.isConnected ? target : true;
        }}
      >
        <Command items={groups} filter={null}>
          <CommandInput
            aria-label={t("shell.search.label")}
            // The short trigger text fits a 390 px phone; the full scope is the description.
            aria-describedby={descriptionId}
            placeholder={t("shell.search.placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <CommandPanel>
            <CommandEmpty>
              <div className="py-6 text-center">
                <Search
                  className="mx-auto mb-2 size-8 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-muted-foreground text-sm">
                  {term.length === 0
                    ? t("shell.search.hint")
                    : t("shell.search.empty", { q: term })}
                </p>
              </div>
            </CommandEmpty>
            {noMatches ? (
              <p className="px-3 pt-3 pb-1 text-muted-foreground text-sm">
                {t("shell.search.empty", { q: term })}
              </p>
            ) : null}
            <CommandList>
              {(group: PortalSearchGroup, index: number) => (
                <Fragment key={group.value}>
                  <CommandGroup items={group.items}>
                    <CommandGroupLabel>{group.label}</CommandGroupLabel>
                    <CommandCollection>
                      {(entry: PortalSearchEntry) => {
                        const Icon = ICONS[entry.kind];
                        return (
                          <CommandItem
                            key={entry.id}
                            value={entry.id}
                            onClick={() => choose(entry)}
                            className="flex items-start gap-3 py-2.5"
                          >
                            <Icon
                              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate font-medium text-sm">
                                {entry.title}
                              </span>
                              {entry.description ? (
                                <span className="truncate text-muted-foreground text-xs">
                                  {entry.description}
                                </span>
                              ) : null}
                            </span>
                          </CommandItem>
                        );
                      }}
                    </CommandCollection>
                  </CommandGroup>
                  {index < groups.length - 1 ? <CommandSeparator /> : null}
                </Fragment>
              )}
            </CommandList>
            <p id={descriptionId} className="sr-only">
              {t("shell.search.hint")}
            </p>
            <p role="status" className="sr-only">
              {searching ? t("shell.search.searching") : ""}
            </p>
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
