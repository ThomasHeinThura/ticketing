import { useNavigate, useParams, useRouter } from "@tanstack/react-router";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
  Kbd,
  KbdGroup,
} from "@taskdesk/ui";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Bookmark,
  CornerDownLeftIcon,
  FileText,
  FolderKanban,
  Hash,
  History,
  User,
  Users,
} from "lucide-react";
import {
  Fragment,
  lazy,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { pushRecentItem } from "@/components/search-command-menu/recent-items";
import {
  type PaletteEntry,
  projectSearchGroups,
  type SearchResultItem,
} from "@/components/search-command-menu/search-targets";
import { useRecentItems } from "@/components/search-command-menu/use-recent-items";
import WorkItemCreateDialogHost from "@/components/work-item/work-item-create-dialog-host";
import { isWorkItemCreateDialogOpen } from "@/components/work-item/work-item-create-dialog-open";
import { shortcuts } from "@/constants/shortcuts";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import useGlobalSearch from "@/hooks/queries/search/use-global-search";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useCanCreateWorkspace from "@/hooks/use-can-create-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { routes } from "@/lib/routes";
import { useUserPreferencesStore } from "@/store/user-preferences";

const SearchCommandMenu = lazy(
  () => import("@/components/search-command-menu"),
);
const CreateWorkspaceModal = lazy(
  () => import("@/components/shared/modals/create-workspace-modal"),
);
const CreateProjectModal = lazy(
  () => import("../shared/modals/create-project-modal"),
);

type PaletteActionItem = {
  value: string;
  label: string;
  shortcut?: string;
  onRun: () => void;
  resultType?: PaletteEntry["type"];
  description?: string;
};

type PaletteGroup = {
  value: string;
  label: string;
  items: PaletteActionItem[];
};

export type CommandPaletteIntent =
  | "search"
  | "projects"
  | "create-project"
  | "create-task"
  | "create-workspace";
export type CommandPaletteRequest = {
  id: number;
  intent: CommandPaletteIntent;
};

const EDITABLE_TARGET =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** The target is, or sits inside, something the person types text into. */
function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(EDITABLE_TARGET) !== null;
}

export function CommandPalette({
  open,
  onOpenChange,
  request,
  onRequestHandled,
  keepMounted,
  focusOriginRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: CommandPaletteRequest | null;
  onRequestHandled: (id: number) => void;
  keepMounted: boolean;
  /** What had focus when the palette or the shortcut was used; the create dialog returns it. */
  focusOriginRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const { setTheme } = useUserPreferencesStore();
  const navigate = useNavigate();
  const router = useRouter();
  const { data: workspace } = useActiveWorkspace();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  // Only an instance administrator creates a workspace (owner decision D-A, 12 Nov 2026).
  const canCreateWorkspace = useCanCreateWorkspace();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = useState(false);
  // Create work item acts on the project the router is showing (`/agent/projects/{key}/...`);
  // the work-item dialog has no project picker, so it is offered only inside a project. Outside
  // one, neither the project nor the permission read is enabled: the palette adds no requests.
  const { projectKey } = useParams({ strict: false });
  const inProject = Boolean(projectKey);
  const { project: routeProject, isLoading: isRouteProjectLoading } =
    useProjectByKey(projectKey ?? "", inProject);
  const createProject = inProject ? routeProject : undefined;
  const { canCreateTasks, isCheckingPermissions } = useWorkspacePermission(
    createProject?.workspaceId,
    createProject?.id,
    { enabled: Boolean(createProject) },
  );
  const canCreateWorkItem = Boolean(createProject) && canCreateTasks();
  // One create dialog at a time: the Overview and the work route mount their own, which this
  // component cannot see, so the shortcut and the palette item check the shared open flag.
  const openCreateWorkItem = useCallback(() => {
    if (isWorkItemCreateDialogOpen()) return;
    setIsCreateTaskOpen(true);
  }, []);
  const [query, setQuery] = useState("");
  const searchTerm = query.trim();
  const searchEnabled = open && searchTerm.length >= 1;
  const { data: searchResults } = useGlobalSearch({
    q: searchEnabled ? searchTerm : "",
    type: "all",
    workspaceId: workspace?.id,
    limit: 20,
  });
  const getCreateFinalFocus = useCallback(() => {
    const origin = focusOriginRef?.current;
    return origin?.isConnected ? origin : false;
  }, [focusOriginRef]);
  const handledRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!request || handledRequest.current === request.id) return;
    // Wait for the signed-in role before deciding, so the request is not dropped while it loads.
    if (request.intent === "create-workspace" && sessionPending) return;
    // A cold load of a project URL (or the shortcut pressed before the project and its
    // permissions have loaded) waits for them instead of dropping the request.
    if (
      request.intent === "create-task" &&
      projectKey &&
      (isRouteProjectLoading || isCheckingPermissions)
    )
      return;
    handledRequest.current = request.id;
    switch (request.intent) {
      case "search":
        setIsSearchOpen(true);
        break;
      case "projects":
        navigate({ to: routes.agentHome.path });
        break;
      case "create-project":
        setIsCreateProjectOpen(true);
        break;
      case "create-task":
        if (canCreateWorkItem) openCreateWorkItem();
        break;
      case "create-workspace":
        if (canCreateWorkspace) setIsCreateWorkspaceOpen(true);
        break;
    }
    onRequestHandled(request.id);
  }, [
    request,
    canCreateWorkspace,
    sessionPending,
    navigate,
    onRequestHandled,
    projectKey,
    isRouteProjectLoading,
    isCheckingPermissions,
    canCreateWorkItem,
    openCreateWorkItem,
  ]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const preloadProjectsPage = useCallback(() => {
    // TanStack's auto-split route component and its nested React.lazy page are
    // separate chunks; warm both as soon as keyboard or pointer intent is clear.
    void router.preloadRoute({ to: routes.agentHome.path }).catch(() => {});
    void import("@/components/project-list/projects-page").catch(() => {});
  }, [router]);

  const handleItemHighlighted = useCallback(
    (value: unknown, { reason }: { reason: string }) => {
      const highlightedValue =
        typeof value === "object" && value !== null && "value" in value
          ? value.value
          : value;
      if (
        highlightedValue === "projects" &&
        (reason === "keyboard" || reason === "pointer")
      ) {
        // Load the route after explicit destination intent. This keeps route
        // work off the palette's opening path and lets keyboard/pointer users
        // warm the route before activating the highlighted command.
        preloadProjectsPage();
      }
    },
    [preloadProjectsPage],
  );

  const runCommand = useCallback(
    (command: () => void) => {
      command();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  const recentItems = useRecentItems(open, session?.user?.id, workspace?.id);

  const searchGroups = useMemo(
    () =>
      projectSearchGroups(
        searchEnabled ? searchTerm : "",
        (searchResults?.results ?? []) as SearchResultItem[],
        recentItems,
        (key) => t(key),
      ),
    [searchEnabled, searchTerm, searchResults?.results, recentItems, t],
  );

  const handleSearchResult = useCallback(
    (entry: PaletteEntry) => {
      if (workspace?.id && session?.user?.id) {
        pushRecentItem(session.user.id, workspace.id, {
          type: entry.type,
          id: entry.id,
          title: entry.title,
          description: entry.description,
          href: entry.href,
        });
      }
      setQuery("");
      onOpenChange(false);
      navigate({ to: entry.href as never });
    },
    [navigate, onOpenChange, workspace?.id, session?.user?.id],
  );

  const getResultIcon = (type: PaletteEntry["type"]) => {
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

  const groupedItems = useMemo<PaletteGroup[]>(
    () => [
      {
        value: "suggestions",
        label: t("navigation:commandPalette.suggestions"),
        items: [
          {
            value: "projects",
            label: t("navigation:commandPalette.projects"),
            shortcut: `${shortcuts.project.prefix} ${shortcuts.project.list}`,
            onRun: () => navigate({ to: routes.agentHome.path }),
          },
          {
            value: "search",
            label: t("navigation:commandPalette.search"),
            shortcut: shortcuts.search.prefix,
            onRun: () => setIsSearchOpen(true),
          },
          {
            value: "members",
            label: t("navigation:commandPalette.members", {
              defaultValue: "Members",
            }),
            onRun: () => {
              navigate({ to: routes.workspaceMembers.path });
            },
          },
          ...(canCreateWorkItem
            ? [
                {
                  value: "create-task",
                  label: t("navigation:commandPalette.createTask"),
                  shortcut: `${shortcuts.task.prefix} ${shortcuts.task.create}`,
                  onRun: openCreateWorkItem,
                },
              ]
            : []),
          {
            value: "create-project",
            label: t("navigation:commandPalette.createProject"),
            shortcut: `${shortcuts.project.prefix} ${shortcuts.project.create}`,
            onRun: () => setIsCreateProjectOpen(true),
          },
        ],
      },
      {
        value: "commands",
        label: t("navigation:commandPalette.commands"),
        items: [
          ...(canCreateWorkspace
            ? [
                {
                  value: "create-workspace",
                  label: t("navigation:commandPalette.createWorkspace"),
                  shortcut: `${shortcuts.workspace.prefix} ${shortcuts.workspace.create}`,
                  onRun: () => setIsCreateWorkspaceOpen(true),
                },
              ]
            : []),
          {
            value: "theme-light",
            label: t("navigation:commandPalette.lightTheme"),
            onRun: () => setTheme("light"),
          },
          {
            value: "theme-dark",
            label: t("navigation:commandPalette.darkTheme"),
            onRun: () => setTheme("dark"),
          },
          {
            value: "theme-system",
            label: t("navigation:commandPalette.systemTheme"),
            onRun: () => setTheme("system"),
          },
          {
            value: "keyboard-shortcuts",
            label: t("navigation:commandPalette.keyboardShortcuts"),
            shortcut: "?",
            onRun: () => {
              setTimeout(() => {
                document.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "?" }),
                );
              }, 100);
            },
          },
        ],
      },
    ],
    [
      navigate,
      setTheme,
      t,
      canCreateWorkspace,
      canCreateWorkItem,
      openCreateWorkItem,
    ],
  );

  const paletteGroups = useMemo<PaletteGroup[]>(() => {
    const queryLower = searchEnabled ? searchTerm.toLowerCase() : "";
    const projectedSearchGroups = searchGroups.map((group) => ({
      value: `search-${group.value}`,
      label: group.label,
      items: group.items.map((entry) => ({
        value: `search:${entry.type}:${entry.id}`,
        label: entry.title,
        description: entry.description,
        resultType: entry.type,
        onRun: () => handleSearchResult(entry),
      })),
    }));
    const visibleActionGroups = groupedItems
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            !queryLower ||
            `${item.label} ${item.value}`.toLowerCase().includes(queryLower),
        ),
      }))
      .filter((group) => group.items.length > 0);

    // Search hits lead when the user is typing; with an empty query, recent
    // destinations precede the existing action and navigation groups.
    return [...projectedSearchGroups, ...visibleActionGroups];
  }, [
    groupedItems,
    handleSearchResult,
    searchEnabled,
    searchGroups,
    searchTerm,
  ]);

  const shortcutHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    for (const group of groupedItems) {
      for (const item of group.items) {
        if (!item.shortcut) continue;
        handlers.set(
          item.shortcut.replace(/\s+/g, "").toLowerCase(),
          item.onRun,
        );
      }
    }
    return handlers;
  }, [groupedItems]);

  useEffect(() => {
    if (!open) return;

    let sequence = "";
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      // Typing in the palette's own search (or any editor) is text, never a shortcut, and
      // it breaks a sequence already started on the way in.
      if (isEditableTarget(event.target)) {
        sequence = "";
        clearTimeout(timeout);
        return;
      }
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key === "Shift"
      ) {
        return;
      }

      if (event.key.length !== 1 && event.key !== "?") {
        return;
      }

      sequence = `${sequence}${event.key.toLowerCase()}`.slice(-3);
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        sequence = "";
      }, 700);

      const handler = shortcutHandlers.get(sequence);
      if (!handler) return;

      event.preventDefault();
      runCommand(handler);
      sequence = "";
      clearTimeout(timeout);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, shortcutHandlers, runCommand]);

  return (
    <>
      <CommandDialog open={open} onOpenChange={onOpenChange}>
        <CommandDialogPopup
          instant
          keepMounted={keepMounted}
          blurBackdrop={false}
        >
          <Command
            items={paletteGroups}
            onItemHighlighted={handleItemHighlighted}
            filter={null}
            mode="none"
            value={query}
            onValueChange={setQuery}
          >
            <CommandInput
              autoFocus={false}
              placeholder={t("navigation:search.inputPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <CommandPanel>
              <CommandEmpty>
                {t("navigation:commandPalette.empty")}
              </CommandEmpty>
              <CommandList>
                {(group: PaletteGroup, groupIndex: number) => (
                  <Fragment key={group.value}>
                    <CommandGroup items={group.items}>
                      <CommandGroupLabel>{group.label}</CommandGroupLabel>
                      <CommandCollection>
                        {(item: PaletteActionItem) => {
                          if (item.resultType) {
                            const Icon =
                              group.value === "search-recent"
                                ? History
                                : getResultIcon(item.resultType);
                            return (
                              <CommandItem
                                key={item.value}
                                value={item.value}
                                onClick={() => runCommand(item.onRun)}
                                className="flex items-start gap-3 py-3"
                                aria-label={`${item.resultType}: ${item.label}`}
                              >
                                <Icon
                                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium">
                                    {item.label}
                                  </div>
                                  {item.description && (
                                    <div className="mt-1 truncate text-xs text-muted-foreground">
                                      {item.description}
                                    </div>
                                  )}
                                </div>
                              </CommandItem>
                            );
                          }
                          return (
                            <CommandItem
                              key={item.value}
                              value={item.value}
                              onClick={() => runCommand(item.onRun)}
                              className="px-3"
                            >
                              <span className="flex-1">{item.label}</span>
                              {item.shortcut && (
                                <CommandShortcut>
                                  {item.shortcut}
                                </CommandShortcut>
                              )}
                            </CommandItem>
                          );
                        }}
                      </CommandCollection>
                    </CommandGroup>
                    {groupIndex < groupedItems.length - 1 && (
                      <CommandSeparator />
                    )}
                  </Fragment>
                )}
              </CommandList>
            </CommandPanel>
            <CommandFooter>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <KbdGroup>
                    <Kbd>
                      <ArrowUpIcon />
                    </Kbd>
                    <Kbd>
                      <ArrowDownIcon />
                    </Kbd>
                  </KbdGroup>
                  <span>{t("navigation:commandPalette.footer.navigate")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Kbd>
                    <CornerDownLeftIcon />
                  </Kbd>
                  <span>{t("navigation:commandPalette.footer.open")}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>Esc</Kbd>
                <span>{t("navigation:commandPalette.footer.close")}</span>
              </div>
            </CommandFooter>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>

      <Suspense fallback={null}>
        {isSearchOpen ? (
          <SearchCommandMenu open setOpen={setIsSearchOpen} />
        ) : null}
        {isCreateTaskOpen && createProject ? (
          <WorkItemCreateDialogHost
            projectId={createProject.id}
            workspaceId={createProject.workspaceId}
            onClose={() => setIsCreateTaskOpen(false)}
            finalFocus={getCreateFinalFocus}
          />
        ) : null}
        {isCreateWorkspaceOpen ? (
          <CreateWorkspaceModal
            open
            onClose={() => setIsCreateWorkspaceOpen(false)}
          />
        ) : null}
        {isCreateProjectOpen ? (
          <CreateProjectModal
            open
            onClose={() => setIsCreateProjectOpen(false)}
          />
        ) : null}
      </Suspense>
    </>
  );
}

export default CommandPalette;
