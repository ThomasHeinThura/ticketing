import { useNavigate } from "@tanstack/react-router";
import { Button, Input, ToggleGroup, ToggleGroupItem } from "@taskdesk/ui";
import { Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  projectSearchGroups,
  type SearchResultItem,
} from "@/components/search-command-menu/search-targets";
import useGlobalSearch from "@/hooks/queries/search/use-global-search";
import { getPriorityIcon } from "@/lib/priority";
import type { AgentGlobalSearch, AgentGlobalSearchScope } from "@/lib/routes";

const DEBOUNCE_MS = 300;

/** The API `type` each URL scope maps onto; everything else is the canonical `all` search. */
const SCOPE_TYPE = {
  all: "all",
  "work-items": "work_items",
  projects: "projects",
} as const satisfies Record<
  AgentGlobalSearchScope,
  "all" | "work_items" | "projects"
>;

type WorkspaceSearchProps = {
  workspaceId: string;
  search: AgentGlobalSearch;
  onSearchChange: (next: AgentGlobalSearch) => void;
};

/**
 * Body of Kaneo's workspace search page, over the canonical search API the Cmd+K palette uses:
 * work items by key, title, description or comment text, plus projects, pages and articles the
 * caller reaches, grouped by kind. `q` and `scope` live in the URL (`routes.workspaceSearch`).
 */
export default function WorkspaceSearch({
  workspaceId,
  search,
  onSearchChange,
}: WorkspaceSearchProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const urlQuery = search.q ?? "";
  const scope: AgentGlobalSearchScope = search.scope ?? "all";
  const [input, setInput] = useState(urlQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Back/forward or a pasted link changes the URL query: mirror it into the input.
  useEffect(() => {
    setInput((current) => (current.trim() === urlQuery ? current : urlQuery));
  }, [urlQuery]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commitQuery = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    const q = value.trim();
    onSearchChange({
      ...(q ? { q } : {}),
      ...(search.scope ? { scope: search.scope } : {}),
    });
  };

  const handleInput = (value: string) => {
    setInput(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commitQuery(value), DEBOUNCE_MS);
  };

  const hasQuery = urlQuery.length > 0;
  const { data, isLoading, isFetching } = useGlobalSearch({
    q: urlQuery,
    workspaceId,
    type: SCOPE_TYPE[scope],
    limit: 20,
  });
  const showLoading = hasQuery && (isLoading || isFetching);

  const groups = useMemo(
    () =>
      projectSearchGroups(
        urlQuery,
        (data?.results ?? []) as SearchResultItem[],
        [],
        (key) => t(key),
      ),
    [urlQuery, data?.results, t],
  );
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  // P1R2-10: Kaneo's result row shows priority, key, project and status; the grouped entry
  // keeps only the link, so the row reads them back from the API result.
  const resultsById = useMemo(
    () =>
      new Map(
        (
          (data?.results ?? []) as (SearchResultItem & {
            projectName?: string;
          })[]
        ).map((item) => [`${item.type}:${item.id}`, item]),
      ),
    [data?.results],
  );

  const quickSearchSuggestions = [
    t("workspace:search.suggestionHighPriority"),
    t("workspace:search.suggestionBug"),
    t("workspace:search.suggestionFeature"),
    t("workspace:search.suggestionInProgress"),
    t("workspace:search.suggestionCompleted"),
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder={t("workspace:search.placeholder")}
            value={input}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitQuery(input);
            }}
            className="pl-10 h-12 text-lg"
            autoFocus
          />
          {showLoading && (
            <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {t("workspace:search.hint")}
          </p>
          <ToggleGroup
            value={[scope]}
            onValueChange={(value) => {
              const next = value[0];
              if (
                next !== "all" &&
                next !== "work-items" &&
                next !== "projects"
              )
                return;
              onSearchChange({
                ...(urlQuery ? { q: urlQuery } : {}),
                ...(next === "all" ? {} : { scope: next }),
              });
            }}
            size="sm"
            aria-label={t("workspace:search.scopeLabel")}
          >
            <ToggleGroupItem value="all">
              {t("workspace:search.scopeAll")}
            </ToggleGroupItem>
            <ToggleGroupItem value="work-items">
              {t("workspace:search.scopeWorkItems")}
            </ToggleGroupItem>
            <ToggleGroupItem value="projects">
              {t("workspace:search.scopeProjects")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {hasQuery ? (
        <div>
          {showLoading && total === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center space-y-4">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  {t("workspace:search.searching")}
                </p>
              </div>
            </div>
          ) : total > 0 ? (
            <div className="space-y-5">
              <p className="text-xs text-muted-foreground">
                {t("workspace:search.resultsFound", { count: total })}
              </p>
              {groups.map((group) => (
                <section
                  key={group.value}
                  aria-label={group.label}
                  className="space-y-1"
                >
                  <h2 className="text-xs font-medium text-muted-foreground mb-2">
                    {group.label}
                  </h2>
                  {group.items.map((entry) => (
                    <Button
                      variant="ghost"
                      key={`${entry.type}:${entry.id}`}
                      type="button"
                      onClick={() => navigate({ to: entry.href as never })}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-background hover:bg-accent/60 transition-colors text-left"
                    >
                      {(() => {
                        const result = resultsById.get(
                          `${entry.type}:${entry.id}`,
                        );
                        if (entry.type !== "work_item" || !result)
                          return (
                            <>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm text-foreground truncate block">
                                  {entry.title}
                                </span>
                              </div>
                              {entry.description && (
                                <span className="text-xs text-muted-foreground flex-shrink-0 max-w-[40%] truncate">
                                  {entry.description}
                                </span>
                              )}
                            </>
                          );
                        return (
                          <>
                            <div className="flex-shrink-0 first:[&_svg]:h-4 first:[&_svg]:w-4">
                              {getPriorityIcon(result.priority ?? "")}
                            </div>
                            {result.key && (
                              <span className="text-xs font-mono text-muted-foreground flex-shrink-0">
                                {result.key}
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              <span className="text-sm text-foreground truncate block">
                                {result.title}
                              </span>
                            </div>
                            {result.projectName && (
                              <span className="text-xs text-muted-foreground flex-shrink-0">
                                {result.projectName}
                              </span>
                            )}
                            {result.status && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded border border-border bg-muted/55 text-muted-foreground flex-shrink-0">
                                {result.status}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </Button>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">
                {t("workspace:search.noResultsTitle")}
              </p>
              <p className="text-muted-foreground">
                {t("workspace:search.noResultsDescription")}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12">
          <Search className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            {t("workspace:search.startTitle")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("workspace:search.startDescription")}
          </p>
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t("workspace:search.quickSearchesLabel")}
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {quickSearchSuggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setInput(suggestion);
                    commitQuery(suggestion);
                  }}
                  className="text-xs"
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
