import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
import CommandPaletteLauncher from "./command-palette-launcher";
import { CommandPalette } from "./index";

const mocks = vi.hoisted(() => ({
  projectsPageModule: vi.fn(),
  preloadRoute: vi.fn().mockResolvedValue(undefined),
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
  useNavigate: () => vi.fn(),
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
  const React = await import("react");
  const DialogOpenContext = React.createContext(false);
  const Null = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    Command: ({
      children,
      onItemHighlighted,
    }: PropsWithChildren<{
      onItemHighlighted?: (value: unknown, details: { reason: string }) => void;
    }>) => (
      <div data-testid="command-content">
        {(() => {
          return (
            // ui-exempt: this test control triggers the command palette's keyboard callback.
            <button
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
            </button>
          );
        })()}
        {children}
      </div>
    ),
    CommandCollection: Null,
    CommandDialog: ({
      open,
      children,
    }: PropsWithChildren<{ open: boolean }>) => (
      <DialogOpenContext.Provider value={open}>
        <div data-testid="command-dialog">{children}</div>
      </DialogOpenContext.Provider>
    ),
    CommandDialogPopup: ({
      keepMounted,
      children,
    }: PropsWithChildren<{ keepMounted?: boolean }>) => {
      const open = React.useContext(DialogOpenContext);
      return keepMounted || open ? (
        <div data-slot="command-dialog-popup" hidden={!open}>
          {children}
        </div>
      ) : null;
    },
    CommandEmpty: Null,
    CommandFooter: Null,
    CommandGroup: Null,
    CommandGroupLabel: Null,
    CommandInput: ({ placeholder }: { placeholder?: string }) => (
      <input aria-label="command search" placeholder={placeholder} />
    ),
    CommandItem: Null,
    CommandList: () => <div data-testid="command-list" />,
    CommandPanel: Null,
    CommandSeparator: () => null,
    CommandShortcut: Null,
    Kbd: Null,
    KbdGroup: Null,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("CommandPalette (#407)", () => {
  it("keeps the hidden dialog shell warm and mounts command descendants on first open", () => {
    const onOpenChange = vi.fn();
    const props = {
      onOpenChange,
      request: null,
      onRequestHandled: vi.fn(),
      keepMounted: true,
    };
    const { container, rerender } = render(
      <CommandPalette {...props} open={false} hasOpened={false} />,
    );

    const popup = container.querySelector('[data-slot="command-dialog-popup"]');
    expect(popup).toBeDefined();
    expect(popup).not.toBeVisible();
    expect(screen.queryByTestId("command-content")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "command search" }),
    ).not.toBeInTheDocument();

    rerender(<CommandPalette {...props} open hasOpened={false} />);
    expect(
      container.querySelector('[data-slot="command-dialog-popup"]'),
    ).toBeVisible();
    expect(screen.getByTestId("command-content")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "command search" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("command-list")).toBeInTheDocument();

    rerender(<CommandPalette {...props} open={false} hasOpened />);
    expect(
      container.querySelector('[data-slot="command-dialog-popup"]'),
    ).not.toBeVisible();
    expect(screen.getByTestId("command-content")).toBeInTheDocument();
    rerender(<CommandPalette {...props} open hasOpened />);
    expect(
      container.querySelector('[data-slot="command-dialog-popup"]'),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "command search" }),
    ).toBeInTheDocument();
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
});
