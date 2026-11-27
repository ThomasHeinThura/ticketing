import de from "@i18n/de-DE.json";
import en from "@i18n/en-US.json";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

describe("revealed content across a profile language change (real provider stack)", () => {
  it("shows the English fallback, never a raw key, while the German deferred fetch is held", async () => {
    window.history.pushState({}, "", "/agent/projects/WLP/work");
    vi.resetModules();
    const { AppI18nProvider } = await import("./provider");
    const { default: NamespaceBoundary } = await import(
      "@/components/common/namespace-boundary"
    );
    const { useTranslation } = await import("react-i18next");
    function Surface() {
      const { t } = useTranslation();
      return <p>{t("tasksExtra:contextMenu.copyLink")}</p>;
    }
    const client = new QueryClient();
    const tree = (children: ReactNode) => (
      <QueryClientProvider client={client}>
        <AppI18nProvider>
          <NamespaceBoundary>{children}</NamespaceBoundary>
        </AppI18nProvider>
      </QueryClientProvider>
    );
    const raw = "contextMenu.copyLink";
    let sawRawKey = false;
    const observer = new MutationObserver(() => {
      if (document.body.textContent?.includes(raw)) sawRawKey = true;
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

    // Switch the profile to German and hold the German deferred fetch.
    state.hold = true;
    state.gate = new Promise<void>((resolve) => {
      state.release = resolve;
    });
    state.locale = "de-DE";
    view.rerender(tree(<Surface />));
    await waitFor(() => expect(document.documentElement.lang).toBe("de-DE"));
    // Let the replacement terminology instance be published.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByText(en.tasksExtra.contextMenu.copyLink)).toBeVisible();
    expect(document.body.textContent).not.toContain(raw);

    await act(async () => state.release());
    expect(
      await screen.findByText(de.tasksExtra.contextMenu.copyLink),
    ).toBeVisible();
    expect(sawRawKey).toBe(false);
    observer.disconnect();
    // Real provider stack and catalog cloning: slower than the 5 s default on a loaded CI runner.
  }, 15_000);
});
