import de from "@i18n/de-DE.json";
import en from "@i18n/en-US.json";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Textarea } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Group mode is chosen once at module load from the URL, so the test sets the URL, resets the
// module registry and imports the real provider stack afresh.
const state = vi.hoisted(() => ({
  locale: "en-US",
  hold: false,
  release: () => {},
  gate: Promise.resolve(),
}));

vi.mock("./after-first-paint", () => ({
  afterFirstPaint: () => Promise.resolve(),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { locale: state.locale } }),
}));
vi.mock("@/fetchers/terminology", () => ({
  getPortalTerminology: vi.fn(),
  getPublicTerminology: async () => ({ terms: {} }),
  getWorkspaceRuntimeTerminology: async () => ({ terms: {} }),
}));
vi.mock("./group-loaders-rest", async () => {
  const actual = await vi.importActual<{
    default: Record<string, () => Promise<unknown>>;
  }>("./group-loaders-rest");
  return {
    default: new Proxy(actual.default, {
      get: (target, locale: string) => () =>
        state.hold && locale === "de-DE"
          ? state.gate.then(() => target[locale]())
          : target[locale](),
    }),
  };
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  state.locale = "en-US";
  state.hold = false;
});

describe("profile language change on the work route (real provider stack)", () => {
  it("keeps the page in English until the whole German locale is loaded, with no mixed frame and an open editor intact", async () => {
    window.history.pushState({}, "", "/agent/projects/WLP/work");
    vi.resetModules();
    const { AppI18nProvider } = await import("./provider");
    const { default: NamespaceBoundary } = await import(
      "@/components/common/namespace-boundary"
    );
    const { useTranslation } = await import("react-i18next");
    function Surface() {
      const { t } = useTranslation();
      return (
        <div>
          <p>{t("common:actions.cancel")}</p>
          <p>{t("tasksExtra:contextMenu.copyLink")}</p>
          <Textarea aria-label="editor" />
        </div>
      );
    }
    const client = new QueryClient();
    const tree = (children: ReactNode) => (
      <QueryClientProvider client={client}>
        <AppI18nProvider>
          <NamespaceBoundary>{children}</NamespaceBoundary>
        </AppI18nProvider>
      </QueryClientProvider>
    );
    const enText = [
      en.common.actions.cancel,
      en.tasksExtra.contextMenu.copyLink,
    ];
    const deText = [
      de.common.actions.cancel,
      de.tasksExtra.contextMenu.copyLink,
    ];
    const raw = "contextMenu.copyLink";
    let mixedOrRaw = false;
    const observer = new MutationObserver(() => {
      const text = document.body.textContent ?? "";
      const english = enText.filter((value) => text.includes(value)).length;
      const german = deText.filter((value) => text.includes(value)).length;
      if (text.includes(raw) || (english > 0 && german > 0)) mixedOrRaw = true;
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    const view = render(tree(<Surface />));
    expect(
      await screen.findByText(en.tasksExtra.contextMenu.copyLink),
    ).toBeVisible();
    const editor = screen.getByLabelText("editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "half-written note" } });

    // Switch the profile to German and hold the German deferred fetch.
    state.hold = true;
    state.gate = new Promise<void>((resolve) => {
      state.release = resolve;
    });
    state.locale = "de-DE";
    view.rerender(tree(<Surface />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    // Nothing of German is shown yet and the document language has not moved.
    expect(document.documentElement.lang).not.toBe("de-DE");
    expect(screen.getByText(en.tasksExtra.contextMenu.copyLink)).toBeVisible();
    expect(screen.getByText(en.common.actions.cancel)).toBeVisible();
    expect(screen.queryByText(de.tasksExtra.contextMenu.copyLink)).toBeNull();
    expect(document.body.textContent).not.toContain(raw);

    await act(async () => state.release());
    expect(
      await screen.findByText(de.tasksExtra.contextMenu.copyLink),
    ).toBeVisible();
    expect(screen.getByText(de.common.actions.cancel)).toBeVisible();
    await waitFor(() => expect(document.documentElement.lang).toBe("de-DE"));
    expect(screen.getByLabelText("editor")).toBe(editor);
    expect(editor.value).toBe("half-written note");
    expect(mixedOrRaw).toBe(false);
    observer.disconnect();
  });
});
