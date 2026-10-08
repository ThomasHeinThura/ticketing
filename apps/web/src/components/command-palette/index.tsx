import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
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
import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon } from "lucide-react";
import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { shortcuts } from "@/constants/shortcuts";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { authClient } from "@/lib/auth-client";
import { useUserPreferencesStore } from "@/store/user-preferences";

const SearchCommandMenu = lazy(
  () => import("@/components/search-command-menu"),
);
const CreateTaskModal = lazy(
  () => import("@/components/shared/modals/create-task-modal"),
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
};

type PaletteGroup = {
  value: string;
  label: string;
  items: PaletteActionItem[];
};

export type CommandPaletteIntent =
  | "open"
  | "close"
  | "search"
  | "projects"
  | "create-project"
  | "create-task"
  | "create-workspace";
export type CommandPaletteRequest = {
  id: number;
  intent: CommandPaletteIntent;
};

export function CommandPalette({
  open,
  onOpenChange,
  request,
  onRequestHandled,
  keepMounted,
  hasOpened,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: CommandPaletteRequest | null;
  onRequestHandled: (id: number) => void;
  keepMounted: boolean;
  hasOpened: boolean;
}) {
  const { t } = useTranslation();
  const { setTheme } = useUserPreferencesStore();
  const navigate = useNavigate();
  const router = useRouter();
  const { data: workspace } = useActiveWorkspace();
  const { data: session } = authClient.useSession();
  const { data: config } = useGetConfig();
  const isAdmin = session?.user?.role === "admin";
  const canCreateWorkspace =
    isAdmin || (config !== undefined && !config.disableWorkspaceCreation);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = useState(false);
  const handledRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!request || handledRequest.current === request.id) return;
    if (
      request.intent === "create-workspace" &&
      !canCreateWorkspace &&
      config === undefined &&
      !isAdmin
    )
      return;
    if (request.intent === "projects" && !workspace?.id) return;
    handledRequest.current = request.id;
    switch (request.intent) {
      case "open":
        onOpenChange(true);
        break;
      case "close":
        onOpenChange(false);
        break;
      case "search":
        setIsSearchOpen(true);
        break;
      case "projects":
        if (workspace?.id) {
          navigate({
            to: "/dashboard/workspace/$workspaceId",
            params: { workspaceId: workspace.id },
          });
        }
        break;
      case "create-project":
        setIsCreateProjectOpen(true);
        break;
      case "create-task":
        setIsCreateTaskOpen(true);
        break;
      case "create-workspace":
        if (canCreateWorkspace) setIsCreateWorkspaceOpen(true);
        break;
    }
    onRequestHandled(request.id);
  }, [
    request,
    canCreateWorkspace,
    config,
    isAdmin,
    workspace?.id,
    navigate,
    onOpenChange,
    onRequestHandled,
  ]);

  const preloadProjectsPage = useCallback(() => {
    if (!workspace?.id) return;
    // TanStack's auto-split route component and its nested React.lazy page are
    // separate chunks; warm both as soon as keyboard or pointer intent is clear.
    void router
      .preloadRoute({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: workspace.id },
      })
      .catch(() => {});
    void import("@/components/project-list/projects-page").catch(() => {});
  }, [router, workspace?.id]);

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
            onRun: () => {
              if (!workspace?.id) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId",
                params: { workspaceId: workspace.id },
              });
            },
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
              navigate({ to: "/dashboard/settings/workspace/members" });
            },
          },
          {
            value: "create-task",
            label: t("navigation:commandPalette.createTask"),
            shortcut: `${shortcuts.task.prefix} ${shortcuts.task.create}`,
            onRun: () => setIsCreateTaskOpen(true),
          },
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
    [navigate, setTheme, t, workspace?.id, canCreateWorkspace],
  );

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
          {hasOpened || open ? (
            <Command
              items={groupedItems}
              onItemHighlighted={handleItemHighlighted}
            >
              <CommandInput
                autoFocus={false}
                placeholder={t("navigation:commandPalette.inputPlaceholder")}
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
                    <span>
                      {t("navigation:commandPalette.footer.navigate")}
                    </span>
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
          ) : null}
        </CommandDialogPopup>
      </CommandDialog>

      <Suspense fallback={null}>
        {isSearchOpen ? (
          <SearchCommandMenu open setOpen={setIsSearchOpen} />
        ) : null}
        {isCreateTaskOpen ? (
          <CreateTaskRouteModal onClose={() => setIsCreateTaskOpen(false)} />
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

function CreateTaskRouteModal({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation();
  const projectId = pathname.match(/\/project\/([^/]+)/)?.[1] ?? undefined;
  const status = pathname.endsWith("/backlog") ? "planned" : undefined;

  return (
    <CreateTaskModal
      open
      projectId={projectId}
      status={status}
      onClose={onClose}
    />
  );
}

export default CommandPalette;
