import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ChangeEventHandler, PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
import SearchCommandMenu from "./index";

const mocks = vi.hoisted(() => ({
  search: vi.fn((_params: { q: string }) => ({ data: undefined })),
}));

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

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "u1" } } }) },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));

vi.mock("@/hooks/queries/search/use-global-search", () => ({
  default: (params: { q: string }) => mocks.search(params),
}));

vi.mock("@taskdesk/ui", async () => {
  const { Input } =
    await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
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
    CommandInput: (props: {
      value?: string;
      onChange?: ChangeEventHandler<HTMLInputElement>;
    }) => <Input aria-label="search query" {...props} />,
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
