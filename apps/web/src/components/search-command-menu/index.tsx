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
import {
  Bookmark,
  FileText,
  FolderKanban,
  Hash,
  History,
  Search,
  User,
  Users,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { shortcuts } from "@/constants/shortcuts";
import useGlobalSearch from "@/hooks/queries/search/use-global-search";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import {
  pushRecentItem,
  type RecentItem,
  readRecentItems,
} from "./recent-items";
import {
  isPaletteResult,
  type PaletteResultType,
  type SearchResultItem,
  searchResultHref,
} from "./search-targets";

type PaletteEntry = {
  id: string;
  type: PaletteResultType;
  title: string;
  description?: string;
  href: string;
};

type SearchGroup = {
  value: string;
  label: string;
  items: PaletteEntry[];
};

type SearchCommandMenuProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

function SearchCommandMenu({ open, setOpen }: SearchCommandMenuProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { data: workspace } = useActiveWorkspace();
  const navigate = useNavigate();

  const searchEnabled = query.trim().length >= 3;

  const { data: searchResults } = useGlobalSearch({
    q: searchEnabled ? query.trim() : "",
    type: "all",
    workspaceId: workspace?.id,
    limit: 20,
  });

  useRegisterShortcuts({
    shortcuts: {
      [shortcuts.search.prefix]: () => {
        setOpen(true);
      },
    },
  });

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const recentItems = useMemo<RecentItem[]>(
    () => (open && workspace?.id ? readRecentItems(workspace.id) : []),
    [open, workspace?.id],
  );

  const handleSelect = (entry: PaletteEntry) => {
    if (workspace?.id) {
      pushRecentItem(workspace.id, {
        type: entry.type,
        id: entry.id,
        title: entry.title,
        description: entry.description,
        href: entry.href,
      });
    }
    setOpen(false);
    setQuery("");
    navigate({ to: entry.href as never });
  };

  const getItemIcon = (type: string) => {
    switch (type) {
      case "work_item":
        return Hash;
      case "project":
        return FolderKanban;
      case "workspace":
        return Users;
      case "saved_view":
        return Bookmark;
      case "person":
        return User;
      default:
        return FileText;
    }
  };

  const groupedItems = useMemo<SearchGroup[]>(() => {
    if (!searchEnabled) {
      return recentItems.length > 0
        ? [
            {
              value: "recent",
              label: t("navigation:search.groups.recent"),
              items: recentItems,
            },
          ]
        : [];
    }
    // The API returns results best match first; groups keep that order, so the group holding
    // the best match (an exact work item key, for instance) comes first (SV-2, SV-4).
    const grouped = new Map<PaletteResultType, PaletteEntry[]>();
    for (const item of (searchResults?.results ?? []) as SearchResultItem[]) {
      if (!isPaletteResult(item)) continue;
      const href = searchResultHref(item);
      if (!href) continue;
      const label = item.type === "work_item" && item.key ? item.key : null;
      const entry: PaletteEntry = {
        id: item.id,
        type: item.type,
        title: label ? `${label} ${item.title}` : item.title,
        description: item.description,
        href,
      };
      const bucket = grouped.get(item.type) ?? [];
      bucket.push(entry);
      grouped.set(item.type, bucket);
    }

    const groupLabel = (type: PaletteResultType) => {
      switch (type) {
        case "work_item":
          return t("navigation:search.groups.workItem");
        case "saved_view":
          return t("navigation:search.groups.savedView");
        case "page":
          return t("navigation:search.groups.page");
        case "project":
          return t("navigation:search.groups.project");
        case "person":
          return t("navigation:search.groups.person");
        case "workspace":
          return t("navigation:search.groups.workspace");
      }
    };

    return [...grouped.entries()].map(([type, items]) => ({
      value: type,
      label: groupLabel(type),
      items,
    }));
  }, [searchEnabled, searchResults?.results, recentItems, t]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandDialogPopup instant>
        <Command items={groupedItems} filter={null}>
          <CommandInput
            placeholder={t("navigation:search.inputPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <CommandPanel>
            <CommandEmpty>
              <div className="text-center py-6">
                <Search className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {searchEnabled
                    ? t("navigation:commandPalette.empty")
                    : t("navigation:search.minCharsHint")}
                </p>
              </div>
            </CommandEmpty>
            <CommandList>
              {(group: SearchGroup, groupIndex: number) => (
                <Fragment key={group.value}>
                  <CommandGroup items={group.items}>
                    <CommandGroupLabel>{group.label}</CommandGroupLabel>
                    <CommandCollection>
                      {(item: PaletteEntry) => {
                        const Icon =
                          group.value === "recent"
                            ? History
                            : getItemIcon(item.type);
                        return (
                          <CommandItem
                            key={`${item.type}-${item.id}`}
                            value={`${item.type}:${item.id}`}
                            onClick={() => handleSelect(item)}
                            className="flex items-start gap-3 py-3"
                            aria-label={`${item.type}: ${item.title}`}
                          >
                            <Icon
                              className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0"
                              aria-hidden="true"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">
                                {item.title}
                              </div>
                              {item.description && (
                                <div className="text-xs text-muted-foreground truncate mt-1">
                                  {item.description}
                                </div>
                              )}
                            </div>
                          </CommandItem>
                        );
                      }}
                    </CommandCollection>
                  </CommandGroup>
                  {groupIndex < groupedItems.length - 1 && <CommandSeparator />}
                </Fragment>
              )}
            </CommandList>
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

export default SearchCommandMenu;
