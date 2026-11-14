import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  type ChangeEventHandler,
  type PropsWithChildren,
  type ReactNode,
  useState,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
import SearchCommandMenu from "./index";
import type { PaletteEntry, SearchGroup } from "./search-targets";

const mocks = vi.hoisted(() => ({
  search: vi.fn((_params: { q: string }) => ({ data: undefined as unknown })),
  navigate: vi.fn(),
  activateWorkspace: vi.fn((_workspaceId: string) =>
    Promise.resolve({ id: "w2" }),
  ),
  toastError: vi.fn(),
  workspaces: [{ id: "w1" }, { id: "w2" }] as Array<{ id: string }>,
  activeOrganizationId: "w1" as string | null,
  groups: [] as SearchGroup[],
  finalFocus: { current: null as null | (() => unknown) },
}));

/**
 * Issue #407: `SearchCommandMenu` is `useRegisterShortcuts`'s other real
 * caller, with the same fresh-inline-config pattern as `CommandPalette`.
 * Mounts it inside the REAL `KeyboardShortcutsProvider` (not a mock of
 * `use-keyboard-shortcuts`) to prove this consumer works too, not just the
 * hook in isolation or the other caller.
 */

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: { id: "u1" },
        session: { activeOrganizationId: mocks.activeOrganizationId },
      },
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
  toast: {
    error: mocks.toastError,
  },
}));

vi.mock("@/hooks/queries/search/use-global-search", () => ({
  default: (params: { q: string }) => mocks.search(params),
}));

vi.mock("@taskdesk/ui", async () => {
  const { Button, Input } =
    await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
  const Null = ({ children }: PropsWithChildren) => <>{children}</>;
  let currentGroupItems: PaletteEntry[] = [];
  return {
    Command: ({
      items,
      children,
    }: PropsWithChildren<{ items?: SearchGroup[] }>) => {
      mocks.groups = items ?? [];
      return <>{children}</>;
    },
    CommandCollection: ({
      children,
    }: {
      children: (item: PaletteEntry) => ReactNode;
    }) => <>{currentGroupItems.map((item) => children(item))}</>,
    CommandDialog: ({
      open,
      children,
    }: PropsWithChildren<{ open: boolean }>) =>
      open ? <div data-testid="search-command-dialog">{children}</div> : null,
    CommandDialogPopup: ({
      children,
      finalFocus,
    }: PropsWithChildren<{ finalFocus?: () => unknown }>) => {
      mocks.finalFocus.current = finalFocus ?? null;
      return <>{children}</>;
    },
    CommandEmpty: Null,
    CommandGroup: ({
      items,
      children,
    }: PropsWithChildren<{ items: PaletteEntry[] }>) => {
      currentGroupItems = items;
      return <div>{children}</div>;
    },
    CommandGroupLabel: Null,
    CommandInput: (props: {
      value?: string;
      onChange?: ChangeEventHandler<HTMLInputElement>;
    }) => <Input aria-label="search query" {...props} />,
    CommandItem: ({
      children,
      onClick,
      "aria-label": ariaLabel,
    }: PropsWithChildren<{
      onClick?: () => void;
      "aria-label"?: string;
    }>) => (
      <Button aria-label={ariaLabel} onClick={onClick} type="button">
        {children}
      </Button>
    ),
    CommandList: ({
      children,
    }: {
      children: (group: SearchGroup, index: number) => ReactNode;
    }) => <>{mocks.groups.map((group, index) => children(group, index))}</>,
    CommandPanel: Null,
    CommandSeparator: () => null,
  };
});

beforeEach(() => {
  mocks.search.mockImplementation(() => ({ data: undefined }));
  mocks.navigate.mockReset();
  mocks.activateWorkspace.mockReset();
  mocks.activateWorkspace.mockImplementation((_workspaceId: string) =>
    Promise.resolve({ id: "w2" }),
  );
  mocks.toastError.mockReset();
  mocks.workspaces = [{ id: "w1" }, { id: "w2" }];
  mocks.activeOrganizationId = "w1";
  mocks.groups = [];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SearchCommandMenu (#407)", () => {
  it("requests a two-character CJK prefix instead of applying a three-character gate", () => {
    render(
      <KeyboardShortcutsProvider>
        <SearchCommandMenu open setOpen={vi.fn()} />
      </KeyboardShortcutsProvider>,
    );

    fireEvent.change(screen.getByLabelText("search query"), {
      target: { value: "性能" },
    });

    expect(mocks.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "性能", workspaceId: "w1" }),
    );
  });

  it("keeps the dialog and query open with a toast when workspace activation is refused or rejects, and closes after activation succeeds", async () => {
    mocks.search.mockImplementation(({ q }: { q: string }) => ({
      data: q
        ? {
            results: [
              { id: "w2", type: "workspace", title: "Ops Workspace" },
              { id: "w-denied", type: "workspace", title: "Denied Workspace" },
            ],
          }
        : undefined,
    }));

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <KeyboardShortcutsProvider>
          <SearchCommandMenu open={open} setOpen={setOpen} />
        </KeyboardShortcutsProvider>
      );
    }

    render(<Harness />);

    fireEvent.change(screen.getByLabelText("search query"), {
      target: { value: "Workspace" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "workspace: Denied Workspace" }),
    );
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "navigation:workspaceSwitcher.switchFailed",
      );
    });
    expect(mocks.activateWorkspace).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("search-command-dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("search query")).toHaveValue("Workspace");

    mocks.toastError.mockClear();
    mocks.activateWorkspace.mockRejectedValueOnce(new Error("403 Forbidden"));

    fireEvent.click(
      screen.getByRole("button", { name: "workspace: Ops Workspace" }),
    );
    await waitFor(() => {
      expect(mocks.activateWorkspace).toHaveBeenCalledWith("w2");
      expect(mocks.toastError).toHaveBeenCalledWith(
        "navigation:workspaceSwitcher.switchFailed",
      );
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("search-command-dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("search query")).toHaveValue("Workspace");

    mocks.activateWorkspace.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "workspace: Ops Workspace" }),
    );
    await waitFor(() => {
      expect(mocks.activateWorkspace).toHaveBeenCalledWith("w2");
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/agent" });
      expect(
        screen.queryByTestId("search-command-dialog"),
      ).not.toBeInTheDocument();
    });
    expect(mocks.activateWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.navigate.mock.invocationCallOrder[0],
    );
  });

  it("mounts inside the real KeyboardShortcutsProvider without hanging or OOMing, closed by default", () => {
    render(
      <KeyboardShortcutsProvider>
        <SearchCommandMenu open={false} setOpen={vi.fn()} />
      </KeyboardShortcutsProvider>,
    );
    expect(
      screen.queryByTestId("search-command-dialog"),
    ).not.toBeInTheDocument();
  });

  it("renders open and unmounts cleanly, unregistering its shortcut", () => {
    const { unmount } = render(
      <KeyboardShortcutsProvider>
        <SearchCommandMenu open={true} setOpen={vi.fn()} />
      </KeyboardShortcutsProvider>,
    );
    expect(screen.getByTestId("search-command-dialog")).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });
});

describe("SearchCommandMenu focus return (A-25)", () => {
  it("returns focus to the element the caller recorded, the sidebar Search button", () => {
    const button = document.createElement("button");
    document.body.append(button);
    render(
      <KeyboardShortcutsProvider>
        <SearchCommandMenu
          open
          setOpen={vi.fn()}
          returnFocusRef={{ current: button }}
        />
      </KeyboardShortcutsProvider>,
    );
    expect(mocks.finalFocus.current?.()).toBe(button);
    button.remove();
    // A trigger that left the page falls back to Base UI's default.
    expect(mocks.finalFocus.current?.()).toBe(true);
  });

  it("records what had focus when the shortcut opened it", () => {
    const origin = document.createElement("button");
    document.body.append(origin);
    origin.focus();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <SearchCommandMenu open={open} setOpen={setOpen} />;
    }
    render(
      <KeyboardShortcutsProvider>
        <Harness />
      </KeyboardShortcutsProvider>,
    );
    fireEvent.keyDown(document, { key: "/" });
    expect(screen.getByTestId("search-command-dialog")).toBeInTheDocument();
    expect(mocks.finalFocus.current?.()).toBe(origin);
    origin.remove();
  });
});
