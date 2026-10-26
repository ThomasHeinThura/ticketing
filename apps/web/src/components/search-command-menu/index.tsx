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
  type PaletteEntry,
  projectSearchGroups,
  type SearchGroup,
  type SearchResultItem,
} from "./search-targets";

type SearchCommandMenuProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

function SearchCommandMenu({ open, setOpen }: SearchCommandMenuProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { data: workspace } = useActiveWorkspace();
  const navigate = useNavigate();

  const searchTerm = query.trim();
  const searchEnabled = searchTerm.length >= 1;

  const { data: searchResults } = useGlobalSearch({
    q: searchEnabled ? searchTerm : "",
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

  const groupedItems = useMemo<SearchGroup[]>(
    () =>
      projectSearchGroups(
        searchEnabled ? searchTerm : "",
        (searchResults?.results ?? []) as SearchResultItem[],
        recentItems,
        (key) => t(key),
      ),
    [searchEnabled, searchTerm, searchResults?.results, recentItems, t],
  );

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
