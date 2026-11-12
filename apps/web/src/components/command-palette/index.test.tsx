import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ChangeEventHandler, PropsWithChildren, ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { markWorkItemCreateDialogOpen } from "@/components/work-item/work-item-create-dialog-open";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
import CommandPaletteLauncher from "./command-palette-launcher";
import { CommandPalette } from "./index";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  projectsPageModule: vi.fn(),
  preloadRoute: vi.fn().mockResolvedValue(undefined),
  sessionRole: undefined as string | undefined,
  activeOrganizationId: "w1" as string | null,
  workspaces: [{ id: "w1" }, { id: "w2" }] as Array<{ id: string }>,
  activateWorkspace: vi.fn((_workspaceId: string) =>
    Promise.resolve({ id: "w2" }),
  ),
  toastError: vi.fn(),
  search: vi.fn((_params: { q: string }) => ({
    data: { results: [] as Array<Record<string, string>> },
  })),
  // The router match the palette reads the current project from.
  params: {} as { projectKey?: string },
  projectByKey: vi.fn(),
  routeProject: undefined as
    | { id: string; workspaceId: string; slug: string }
    | undefined,
  routeProjectLoading: false,
  permissionTarget: vi.fn(),
  canCreate: true,
  checkingPermissions: false,
  // What the mocked shared create dialog was last given.
  createClose: undefined as undefined | (() => void),
  createFinalFocus: undefined as undefined | (() => HTMLElement | false),
}));

/**
 * Issue #407: rendering `CommandPalette` inside the real
 * `KeyboardShortcutsProvider` used to hang/OOM a test runner (its
 * `useRegisterShortcuts` call passes a fresh inline config object every
 * render, which looped the provider forever -- see
 * `apps/web/src/hooks/use-keyboard-shortcuts.test.tsx` for the mechanism
 * and the fix). This is almost certainly why no component-level test for
 * `CommandPalette` existed before that fix landed. This test intentionally
 * uses the REAL provider (not a mock of `use-keyboard-shortcuts`) to prove
 * the actual integration point now works, not just the hook in isolation.
 */

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  // The URL is deliberately not readable here: the project must come from the route match.
  useParams: () => mocks.params,
  useRouter: () => ({ preloadRoute: mocks.preloadRoute }),
}));

vi.mock("@/components/project-list/projects-page", () => {
  mocks.projectsPageModule();
  return { default: () => null };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: mocks.sessionRole
        ? {
            user: { id: "u-1", role: mocks.sessionRole },
            session: { activeOrganizationId: mocks.activeOrganizationId },
          }
        : mocks.activeOrganizationId
          ? {
              user: { id: "u-1" },
              session: { activeOrganizationId: mocks.activeOrganizationId },
            }
          : undefined,
    }),
  },
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({ data: mocks.workspaces }),
}));
vi.mock("@/lib/activate-workspace-for-navigation", () => ({
  activateWorkspaceForNavigation: (workspaceId: string) =>
    mocks.activateWorkspace(workspaceId),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError },
}));

vi.mock("@/hooks/queries/search/use-global-search", () => ({
  default: (params: { q: string }) => mocks.search(params),
}));

vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => ({ setTheme: vi.fn() }),
}));

vi.mock("@/components/search-command-menu", () => ({ default: () => null }));
vi.mock("@/hooks/queries/agile/use-project-by-key", () => ({
  default: (projectKey: string, enabled?: boolean) => {
    mocks.projectByKey(projectKey, enabled);
    return {
      project: mocks.routeProject,
      workspaceId: "w1",
      isLoading: mocks.routeProjectLoading,
    };
  },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (
    workspaceId?: string,
    projectId?: string,
    options?: { enabled?: boolean },
  ) => {
    mocks.permissionTarget(workspaceId, projectId, options);
    return {
      canCreateTasks: () => mocks.canCreate,
      isCheckingPermissions: mocks.checkingPermissions,
    };
  },
}));
vi.mock("@/components/work-item/work-item-create-dialog-host", () => ({
  default: ({
    projectId,
    workspaceId,
    onClose,
    finalFocus,
  }: {
    projectId: string;
    workspaceId?: string;
    onClose: () => void;
    finalFocus: () => HTMLElement | false;
  }) => {
    mocks.createClose = onClose;
    mocks.createFinalFocus = finalFocus;
    return (
      <div
        data-testid="create-work-item-dialog-host"
        data-project-id={projectId}
        data-workspace-id={workspaceId}
      />
    );
  },
}));
vi.mock("@/components/shared/modals/create-workspace-modal", () => ({
  default: () => null,
}));
vi.mock("@/components/shared/modals/create-project-modal", () => ({
  default: () => null,
}));

// The design-system primitives aren't what this test is about; stub them
// out so the test isn't coupled to unrelated rendering, same approach the
// #294 regression test (command-palette/index.test.tsx on that branch)
// uses.
vi.mock("@taskdesk/ui", async () => {
  const { Button, Input } =
    await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
  const Null = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    Command: ({
      children,
      onItemHighlighted,
      items,
    }: PropsWithChildren<{
      onItemHighlighted?: (value: unknown, details: { reason: string }) => void;
      items?: Array<{
        items: Array<{ value: string; label: string; onRun?: () => void }>;
      }>;
    }>) => (
      <>
        {(() => {
          return (
            <Button
              type="button"
              data-testid="highlight-project-command"
              onClick={() =>
                onItemHighlighted?.(
                  { value: "projects" },
                  { reason: "keyboard" },
                )
              }
            >
              Highlight Projects with keyboard
            </Button>
          );
        })()}
        <div data-testid="palette-items">
          {items?.flatMap((group) =>
            group.items.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant="ghost"
                onClick={() => item.onRun?.()}
              >
                {item.label}
              </Button>
            )),
          )}
        </div>
        {children}
      </>
    ),
    CommandCollection: Null,
    CommandDialog: ({
      open,
      children,
    }: PropsWithChildren<{ open: boolean }>) =>
      open ? <div data-testid="command-dialog">{children}</div> : null,
    CommandDialogPopup: Null,
    CommandEmpty: Null,
    CommandFooter: Null,
    CommandGroup: Null,
    CommandGroupLabel: Null,
    CommandInput: (props: {
      value?: string;
      onChange?: ChangeEventHandler<HTMLInputElement>;
    }) => <Input aria-label="palette search query" {...props} />,
    CommandItem: Null,
    CommandList: () => null,
    CommandPanel: Null,
    CommandSeparator: () => null,
    CommandShortcut: Null,
    Kbd: Null,
    KbdGroup: Null,
  };
});

beforeAll(async () => {
  // Warm the public library entry outside the first keyboard interaction's
  // five-second guard. The launcher imports its palette lazily, so its static
  // import above does not invoke this mock factory before this hook.
  await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
});

beforeEach(() => {
  mocks.sessionRole = undefined;
  mocks.activeOrganizationId = "w1";
  mocks.workspaces = [{ id: "w1" }, { id: "w2" }];
  mocks.activateWorkspace.mockReset();
  mocks.activateWorkspace.mockImplementation((_workspaceId: string) =>
    Promise.resolve({ id: "w2" }),
  );
  mocks.toastError.mockReset();
  mocks.params = {};
  mocks.routeProject = undefined;
  mocks.routeProjectLoading = false;
  mocks.canCreate = true;
  mocks.checkingPermissions = false;
  mocks.createClose = undefined;
  mocks.createFinalFocus = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function renderLauncher(extra?: ReactNode) {
  const tree = (
    <KeyboardShortcutsProvider>
      {extra}
      <CommandPaletteLauncher />
    </KeyboardShortcutsProvider>
  );
  const view = render(tree);
  return {
    ...view,
    // A fresh element with the same shape, so the palette re-reads the mocked hooks.
    refresh: () =>
      view.rerender(
        <KeyboardShortcutsProvider>
          {extra}
          <CommandPaletteLauncher />
        </KeyboardShortcutsProvider>,
      ),
  };
}

/** A two-key shortcut: the prefix is state, so each key is its own render, as for a person. */
async function pressSequence(prefix: string, key: string) {
  await act(async () => {
    fireEvent.keyDown(document, { key: prefix });
  });
  await act(async () => {
    fireEvent.keyDown(document, { key });
    await vi.dynamicImportSettled();
  });
}

const pressCreateWorkItemShortcut = () => pressSequence("t", "c");

async function openPalette() {
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  await vi.waitFor(() =>
    expect(screen.getByTestId("command-dialog")).toBeInTheDocument(),
  );
}

describe("CommandPalette (#407)", () => {
  it("searches from Cmd+K while keeping the navigation and action commands available", async () => {
    mocks.search.mockImplementation(({ q }) => ({
      data: {
        results: q
          ? [
              {
                id: "item-1",
                type: "work_item",
                key: "PERF-1",
                title: "性能測試項目",
              },
            ]
          : [],
      },
    }));
    render(
      <KeyboardShortcutsProvider>
        <CommandPaletteLauncher />
      </KeyboardShortcutsProvider>,
    );

    await act(async () => {
      fireEvent.keyDown(document, { key: "k", ctrlKey: true });
      await vi.dynamicImportSettled();
    });
    expect(screen.getByTestId("command-dialog")).toBeInTheDocument();
    expect(
      screen.getByText("navigation:commandPalette.projects"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("navigation:commandPalette.search"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("palette search query"), {
      target: { value: "性能" },
    });

    await vi.waitFor(() =>
      expect(mocks.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "性能", workspaceId: "w1" }),
      ),
    );
    expect(screen.getByText("PERF-1 性能測試項目")).toBeInTheDocument();
  });

  it("mounts inside the real KeyboardShortcutsProvider without hanging or OOMing", () => {
    render(
      <KeyboardShortcutsProvider>
        <CommandPaletteLauncher />
      </KeyboardShortcutsProvider>,
    );
    // Closed by default -- proves the tree actually finished rendering
    // rather than us just reaching this line by luck.
    expect(screen.queryByTestId("command-dialog")).not.toBeInTheDocument();
  });

  it("unmounts cleanly, unregistering its shortcuts", () => {
    const { unmount } = render(
      <KeyboardShortcutsProvider>
        <CommandPaletteLauncher />
      </KeyboardShortcutsProvider>,
    );
    expect(() => unmount()).not.toThrow();
  });

  it("preloads the Projects page chunk on explicit keyboard destination intent", async () => {
    render(
      <KeyboardShortcutsProvider>
        <CommandPaletteLauncher />
      </KeyboardShortcutsProvider>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await vi.waitFor(() =>
      expect(screen.getByTestId("command-dialog")).toBeInTheDocument(),
    );
    expect(mocks.projectsPageModule).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("highlight-project-command"));

    await vi.waitFor(() =>
      expect(mocks.projectsPageModule).toHaveBeenCalledOnce(),
    );
    expect(mocks.preloadRoute).toHaveBeenCalledWith({ to: "/agent" });
  });

  it("opens the Projects command at /agent, not the old workspace list", async () => {
    renderLauncher();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await vi.waitFor(() =>
      expect(screen.getByTestId("command-dialog")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("navigation:commandPalette.projects"));

    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/agent" });
    expect(mocks.navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "/dashboard/workspace/$workspaceId" }),
    );
  });

  it("opens Projects at /agent from the p l shortcut", async () => {
    renderLauncher();

    await pressSequence("p", "l");

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/agent" }),
    );
  });

  it("opens the workspace members page that exists, not a missing settings URL", async () => {
    render(
      <KeyboardShortcutsProvider>
        <CommandPaletteLauncher />
      </KeyboardShortcutsProvider>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await vi.waitFor(() =>
      expect(screen.getByTestId("command-dialog")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("navigation:commandPalette.members"));

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/dashboard/settings/workspace/members",
    });
  });
});

describe("CommandPalette create-workspace command (D-A, 12 Nov 2026)", () => {
  async function openCreateWorkspacePalette() {
    render(
      <KeyboardShortcutsProvider>
        <CommandPaletteLauncher />
      </KeyboardShortcutsProvider>,
    );
    await act(async () => {
      fireEvent.keyDown(document, { key: "k", ctrlKey: true });
      await vi.dynamicImportSettled();
    });
    expect(screen.getByTestId("command-dialog")).toBeInTheDocument();
  }

  afterEach(() => {
    mocks.sessionRole = undefined;
  });

  it("offers no create-workspace command to anyone but an instance admin", async () => {
    mocks.sessionRole = "user";
    await openCreateWorkspacePalette();

    expect(
      screen.getByText("navigation:commandPalette.lightTheme"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("navigation:commandPalette.createWorkspace"),
    ).toBeNull();
  });

  it("offers the create-workspace command to an instance admin", async () => {
    mocks.sessionRole = "admin";
    await openCreateWorkspacePalette();

    expect(
      screen.getByText("navigation:commandPalette.createWorkspace"),
    ).toBeInTheDocument();
  });
});

describe("CommandPalette create work item (D-6)", () => {
  const helpProject = { id: "p1", workspaceId: "w1", slug: "HELP" };

  it("opens the shared work-item dialog for the project in the route from the t c shortcut", async () => {
    mocks.params = { projectKey: "HELP" };
    mocks.routeProject = helpProject;
    renderLauncher();

    await pressCreateWorkItemShortcut();

    const dialog = await screen.findByTestId("create-work-item-dialog-host");
    expect(dialog).toHaveAttribute("data-project-id", "p1");
    expect(dialog).toHaveAttribute("data-workspace-id", "w1");
    // The project is found from the route key, then checked for permission in that project.
    expect(mocks.projectByKey).toHaveBeenCalledWith("HELP", true);
    expect(mocks.permissionTarget).toHaveBeenCalledWith("w1", "p1", {
      enabled: true,
    });
  });

  it("reads no project and checks no permission outside a project", async () => {
    renderLauncher();
    await openPalette();

    expect(mocks.projectByKey).toHaveBeenCalledWith("", false);
    expect(mocks.projectByKey).not.toHaveBeenCalledWith(
      expect.anything(),
      true,
    );
    expect(mocks.permissionTarget).toHaveBeenCalledWith(undefined, undefined, {
      enabled: false,
    });
    expect(mocks.permissionTarget).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { enabled: true },
    );
  });

  it("checks no permission until the route's project is known", async () => {
    mocks.params = { projectKey: "HELP" };
    mocks.routeProjectLoading = true;
    renderLauncher();
    await openPalette();

    expect(mocks.projectByKey).toHaveBeenCalledWith("HELP", true);
    expect(mocks.permissionTarget).toHaveBeenCalledWith(undefined, undefined, {
      enabled: false,
    });
    expect(mocks.permissionTarget).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { enabled: true },
    );
  });

  it("ignores the shortcut while another create dialog is already open, then works again", async () => {
    mocks.params = { projectKey: "HELP" };
    mocks.routeProject = helpProject;
    // A dialog the palette cannot see: the work route's, or the Overview's.
    const release = markWorkItemCreateDialogOpen();
    renderLauncher();
    try {
      await pressCreateWorkItemShortcut();
      expect(
        screen.queryByTestId("create-work-item-dialog-host"),
      ).not.toBeInTheDocument();
    } finally {
      release();
    }

    await pressCreateWorkItemShortcut();
    expect(
      await screen.findByTestId("create-work-item-dialog-host"),
    ).toBeInTheDocument();
  });

  it("does not open a second dialog from the palette item while one is open", async () => {
    mocks.params = { projectKey: "HELP" };
    mocks.routeProject = helpProject;
    const release = markWorkItemCreateDialogOpen();
    renderLauncher();
    try {
      await openPalette();
      fireEvent.click(screen.getByText("navigation:commandPalette.createTask"));
      expect(
        screen.queryByTestId("create-work-item-dialog-host"),
      ).not.toBeInTheDocument();
    } finally {
      release();
    }
  });

  it("offers Create in the palette inside a project and opens the same dialog", async () => {
    mocks.params = { projectKey: "HELP" };
    mocks.routeProject = helpProject;
    renderLauncher();
    await openPalette();

    fireEvent.click(screen.getByText("navigation:commandPalette.createTask"));

    expect(
      await screen.findByTestId("create-work-item-dialog-host"),
    ).toHaveAttribute("data-project-id", "p1");
  });

  it("closes the dialog through its own close callback", async () => {
    mocks.params = { projectKey: "HELP" };
    mocks.routeProject = helpProject;
    renderLauncher();
    await pressCreateWorkItemShortcut();
    await screen.findByTestId("create-work-item-dialog-host");

    act(() => mocks.createClose?.());

    expect(
      screen.queryByTestId("create-work-item-dialog-host"),
    ).not.toBeInTheDocument();
  });

  it("hides Create outside a project and ignores the shortcut there", async () => {
    renderLauncher();
    await openPalette();
    expect(
      screen.queryByText("navigation:commandPalette.createTask"),
    ).not.toBeInTheDocument();
    // The palette's other actions are still offered.
    expect(
      screen.getByText("navigation:commandPalette.createProject"),
    ).toBeInTheDocument();
    cleanup();

    renderLauncher();
    await pressCreateWorkItemShortcut();
    expect(
      screen.queryByTestId("create-work-item-dialog-host"),
    ).not.toBeInTheDocument();
  });

  it("hides Create and ignores the shortcut when the actor cannot create work items", async () => {
    mocks.params = { projectKey: "HELP" };
    mocks.routeProject = helpProject;
    mocks.canCreate = false;
    renderLauncher();
    await openPalette();
    expect(
      screen.queryByText("navigation:commandPalette.createTask"),
    ).not.toBeInTheDocument();
    cleanup();

    renderLauncher();
    await pressCreateWorkItemShortcut();
    expect(
      screen.queryByTestId("create-work-item-dialog-host"),
    ).not.toBeInTheDocument();
  });

  it("ignores the shortcut on a project URL that matches no project", async () => {
    mocks.params = { projectKey: "NOPE" };
    renderLauncher();

    await pressCreateWorkItemShortcut();

    expect(
      screen.queryByTestId("create-work-item-dialog-host"),
    ).not.toBeInTheDocument();
  });

  it("waits for a cold project and its permissions to load instead of dropping the shortcut", async () => {
    mocks.params = { projectKey: "HELP" };
    mocks.routeProjectLoading = true;
    const view = renderLauncher();

    await pressCreateWorkItemShortcut();
    expect(
      screen.queryByTestId("create-work-item-dialog-host"),
    ).not.toBeInTheDocument();

    mocks.routeProject = helpProject;
    mocks.checkingPermissions = true;
    mocks.routeProjectLoading = false;
    await act(async () => view.refresh());
    expect(
      screen.queryByTestId("create-work-item-dialog-host"),
    ).not.toBeInTheDocument();

    mocks.checkingPermissions = false;
    await act(async () => view.refresh());
    expect(
      await screen.findByTestId("create-work-item-dialog-host"),
    ).toHaveAttribute("data-project-id", "p1");
  });

  it("hands focus back to where the shortcut was used, and to nothing once that is gone", async () => {
    const { Button } =
      await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
    mocks.params = { projectKey: "HELP" };
    mocks.routeProject = helpProject;
    const view = renderLauncher(<Button>Where I was</Button>);
    const origin = screen.getByRole("button", { name: "Where I was" });
    origin.focus();

    await pressCreateWorkItemShortcut();
    await screen.findByTestId("create-work-item-dialog-host");
    expect(mocks.createFinalFocus?.()).toBe(origin);

    view.unmount();
    expect(mocks.createFinalFocus?.()).toBe(false);
  });

  it("hands focus back to where the palette was opened from", async () => {
    const { Button } =
      await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
    mocks.params = { projectKey: "HELP" };
    mocks.routeProject = helpProject;
    renderLauncher(<Button>Where I was</Button>);
    const origin = screen.getByRole("button", { name: "Where I was" });
    origin.focus();
    await openPalette();

    // Moving focus into the palette must not change where the dialog returns it.
    screen.getByLabelText("palette search query").focus();
    fireEvent.click(screen.getByText("navigation:commandPalette.createTask"));

    await screen.findByTestId("create-work-item-dialog-host");
    expect(mocks.createFinalFocus?.()).toBe(origin);
  });
});

// The palette has its own document keydown listener for the shortcuts it lists, separate from
// the global provider's. It is rendered alone here so only that listener is under test.
describe("CommandPalette typing guard (D-6)", () => {
  const helpProject = { id: "p1", workspaceId: "w1", slug: "HELP" };

  function renderOpenPalette(extra?: ReactNode) {
    mocks.params = { projectKey: "HELP" };
    mocks.routeProject = helpProject;
    const onOpenChange = vi.fn();
    render(
      <>
        <CommandPalette
          open
          onOpenChange={onOpenChange}
          request={null}
          onRequestHandled={vi.fn()}
          keepMounted={false}
        />
        {extra}
      </>,
    );
    return { onOpenChange };
  }

  const pressKeys = (target: Element, ...keys: string[]) => {
    for (const key of keys) fireEvent.keyDown(target, { key });
  };

  it("still runs a listed shortcut typed outside any text field (control)", async () => {
    const { onOpenChange } = renderOpenPalette();

    pressKeys(document.body, "t", "c");

    expect(
      await screen.findByTestId("create-work-item-dialog-host"),
    ).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("treats typing t c in the palette search as text: no dialog, palette open, query intact", () => {
    const { onOpenChange } = renderOpenPalette();
    const search = screen.getByLabelText(
      "palette search query",
    ) as HTMLInputElement;
    search.focus();

    pressKeys(search, "t", "c");
    fireEvent.change(search, { target: { value: "tc" } });

    expect(
      screen.queryByTestId("create-work-item-dialog-host"),
    ).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("command-dialog")).toBeInTheDocument();
    expect(search.value).toBe("tc");
  });

  it("ignores keys typed inside an editable region, including its children", () => {
    const { onOpenChange } = renderOpenPalette(
      <div contentEditable="true">
        <span data-testid="inside-editor">text</span>
      </div>,
    );

    pressKeys(screen.getByTestId("inside-editor"), "t", "c");

    expect(
      screen.queryByTestId("create-work-item-dialog-host"),
    ).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("drops a sequence started outside a text field once a key is typed into one", () => {
    renderOpenPalette();
    const search = screen.getByLabelText("palette search query");

    pressKeys(document.body, "t");
    pressKeys(search, "x");
    pressKeys(document.body, "c");

    expect(
      screen.queryByTestId("create-work-item-dialog-host"),
    ).not.toBeInTheDocument();
  });
});

describe("CommandPalette workspace search results (F-2)", () => {
  it("activates an authorized workspace before navigating to /agent, and keeps the palette and query open with a translated toast on refusal or failure", async () => {
    mocks.search.mockImplementation(({ q }: { q: string }) => ({
      data: {
        results: q
          ? [
              { id: "w2", type: "workspace", title: "Ops Workspace" },
              { id: "w-denied", type: "workspace", title: "Denied Workspace" },
            ]
          : [],
      },
    }));

    renderLauncher();
    await openPalette();

    fireEvent.change(screen.getByLabelText("palette search query"), {
      target: { value: "Workspace" },
    });

    fireEvent.click(await screen.findByText("Denied Workspace"));
    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "navigation:workspaceSwitcher.switchFailed",
      );
    });
    expect(mocks.activateWorkspace).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("command-dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("palette search query")).toHaveValue(
      "Workspace",
    );

    mocks.toastError.mockClear();
    mocks.activateWorkspace.mockRejectedValueOnce(new Error("403 Forbidden"));

    fireEvent.click(screen.getByText("Ops Workspace"));
    await vi.waitFor(() => {
      expect(mocks.activateWorkspace).toHaveBeenCalledWith("w2");
      expect(mocks.toastError).toHaveBeenCalledWith(
        "navigation:workspaceSwitcher.switchFailed",
      );
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("command-dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("palette search query")).toHaveValue(
      "Workspace",
    );

    mocks.activateWorkspace.mockClear();
    fireEvent.click(screen.getByText("Ops Workspace"));
    await vi.waitFor(() => {
      expect(mocks.activateWorkspace).toHaveBeenCalledWith("w2");
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/agent" });
      expect(screen.queryByTestId("command-dialog")).not.toBeInTheDocument();
    });
    expect(mocks.activateWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.navigate.mock.invocationCallOrder[0],
    );
  });
});
