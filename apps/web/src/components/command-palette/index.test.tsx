import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "./index";

/**
 * Issue #294: pressing "?" used to recurse forever. `CommandPalette`
 * registered a handler for the "?" shortcut that re-dispatched a synthetic
 * "?" keydown on `document`; `KeyboardShortcutsProvider`'s single
 * document-level listener (apps/web/src/hooks/use-keyboard-shortcuts.ts)
 * picked that synthetic event back up, found "?" registered again, and
 * called the handler again -- RangeError: Maximum call stack size exceeded.
 *
 * `useRegisterShortcuts` is mocked here (capturing its argument) rather than
 * wrapped in the real `KeyboardShortcutsProvider`: that provider has a
 * separate, pre-existing bug -- its registration effect depends on the
 * whole config object's identity, and every caller (including this file's
 * `modifierShortcuts`/`sequentialShortcuts` entries, untouched by this fix)
 * passes a fresh literal each render, which loops the provider forever
 * regardless of the "?" handler. That is out of scope for #294 and is
 * flagged separately. Capturing the real config `CommandPalette` builds,
 * then modelling the provider's actual single-listener re-invocation
 * mechanism by hand, tests the exact thing #294 is about without tripping
 * that unrelated defect.
 */

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/dashboard/workspace/w1" }),
}));

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
  default: () => ({ data: undefined }),
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

// The palette UI itself (the command dialog, its list, footer, etc.) is not
// what this bug lives in -- it's the shortcut registration call. Stub the
// design system out so the test isn't coupled to unrelated rendering.
vi.mock("@taskdesk/ui", () => {
  const Null = () => null;
  return {
    Command: Null,
    CommandCollection: Null,
    CommandDialog: Null,
    CommandDialogPopup: Null,
    CommandEmpty: Null,
    CommandFooter: Null,
    CommandGroup: Null,
    CommandGroupLabel: Null,
    CommandInput: Null,
    CommandItem: Null,
    CommandList: Null,
    CommandPanel: Null,
    CommandSeparator: Null,
    CommandShortcut: Null,
    Kbd: Null,
    KbdGroup: Null,
  };
});

type ShortcutsConfig = {
  shortcuts?: Record<string, () => void>;
  sequentialShortcuts?: Record<string, Record<string, () => void>>;
  modifierShortcuts?: Record<string, Record<string, () => void>>;
};

let capturedConfig: ShortcutsConfig | null = null;

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useRegisterShortcuts: (config: ShortcutsConfig) => {
    capturedConfig = config;
  },
  getModifierKeyText: () => "Ctrl",
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  capturedConfig = null;
});

describe("CommandPalette help shortcut (#294)", () => {
  it("dispatches at most once per '?' keypress, with no recursive dispatchEvent", () => {
    render(<CommandPalette />);

    const helpHandler = capturedConfig?.shortcuts?.["?"];

    if (!helpHandler) {
      // The fix: no handler is registered for "?" at all, so the shared
      // provider's single document-level listener has nothing to
      // re-invoke when a "?" keydown (real or synthetic) arrives -- zero
      // recursion by construction.
      expect(helpHandler).toBeUndefined();
      return;
    }

    // Guards the mechanism itself in case a "?" handler is ever
    // reintroduced: model `KeyboardShortcutsProvider`'s actual behavior
    // (one shared document-level listener that looks up and calls
    // whatever is registered for the dispatched event's key) and assert
    // the handler fires at most once per keypress rather than recursing.
    let handlerCalls = 0;
    const spy = vi
      .spyOn(document, "dispatchEvent")
      .mockImplementation((event) => {
        if ((event as KeyboardEvent).key === "?") {
          handlerCalls += 1;
          if (handlerCalls > 5) {
            throw new Error("recursive dispatchEvent detected");
          }
          helpHandler();
        }
        return true;
      });

    helpHandler();
    spy.mockRestore();

    expect(handlerCalls).toBeLessThanOrEqual(1);
  });
});
