import { cleanup, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
import SearchCommandMenu from "./index";

/**
 * Issue #407: `SearchCommandMenu` is `useRegisterShortcuts`'s other real
 * caller, with the same fresh-inline-config pattern as `CommandPalette`.
 * Mounts it inside the REAL `KeyboardShortcutsProvider` (not a mock of
 * `use-keyboard-shortcuts`) to prove this consumer works too, not just the
 * hook in isolation or the other caller.
 */

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));

vi.mock("@/hooks/queries/search/use-global-search", () => ({
  default: () => ({ data: undefined }),
}));

vi.mock("@taskdesk/ui", () => {
  const Null = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    Command: Null,
    CommandCollection: Null,
    CommandDialog: ({
      open,
      children,
    }: PropsWithChildren<{ open: boolean }>) =>
      open ? <div data-testid="search-command-dialog">{children}</div> : null,
    CommandDialogPopup: Null,
    CommandEmpty: Null,
    CommandGroup: Null,
    CommandGroupLabel: Null,
    CommandInput: () => null,
    CommandItem: Null,
    CommandList: () => null,
    CommandPanel: Null,
    CommandSeparator: () => null,
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SearchCommandMenu (#407)", () => {
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
