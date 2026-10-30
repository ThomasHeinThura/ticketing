import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ChangeEventHandler, PropsWithChildren } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
import CommandPaletteLauncher from "./command-palette-launcher";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  projectsPageModule: vi.fn(),
  preloadRoute: vi.fn().mockResolvedValue(undefined),
  search: vi.fn((_params: { q: string }) => ({
    data: { results: [] as Array<Record<string, string>> },
  })),
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
  useLocation: () => ({ pathname: "/dashboard/workspace/w1" }),
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
    useSession: () => ({ data: undefined }),
  },
}));

vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: undefined }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));

vi.mock("@/hooks/queries/search/use-global-search", () => ({
  default: (params: { q: string }) => mocks.search(params),
}));

vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => ({ setTheme: vi.fn() }),
}));

vi.mock("@/components/search-command-menu", () => ({ default: () => null }));
vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: () => null,
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

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
    expect(mocks.preloadRoute).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId",
      params: { workspaceId: "w1" },
    });
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
      to: "/dashboard/workspace/$workspaceId/members",
      params: { workspaceId: "w1" },
    });
  });
});
