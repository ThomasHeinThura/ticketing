import { useQueryClient } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import queryClient from "@/query-client";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { PortalApplicationProviders } from "./portal-application-providers";

const observeClient = vi.fn();

function QueryClientConsumer() {
  observeClient(useQueryClient());
  return null;
}

describe("portal application providers", () => {
  afterEach(() => {
    cleanup();
    observeClient.mockClear();
  });

  it("provides the shared query client to portal route descendants", () => {
    render(
      <PortalApplicationProviders>
        <QueryClientConsumer />
      </PortalApplicationProviders>,
    );

    expect(observeClient).toHaveBeenCalledWith(queryClient);
  });
});

describe("portal theme (#679)", () => {
  type Listener = (event: MediaQueryListEvent) => void;
  let listeners: Listener[];
  let prefersDark: boolean;

  beforeEach(() => {
    listeners = [];
    prefersDark = true;
    localStorage.clear();
    document.documentElement.className = "";
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(prefers-color-scheme: dark)" && prefersDark,
        media: query,
        addEventListener: (_: string, l: Listener) => listeners.push(l),
        removeEventListener: (_: string, l: Listener) => {
          listeners = listeners.filter((x) => x !== l);
        },
      })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("applies .dark under a dark OS preference with no stored theme", () => {
    render(<PortalApplicationProviders>{null}</PortalApplicationProviders>);
    expect(document.documentElement).toHaveClass("dark");
  });

  it("applies .light under a light OS preference with no stored theme", () => {
    prefersDark = false;
    render(<PortalApplicationProviders>{null}</PortalApplicationProviders>);
    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("follows OS preference changes while mounted", () => {
    prefersDark = false;
    render(<PortalApplicationProviders>{null}</PortalApplicationProviders>);
    act(() => {
      for (const l of listeners) l({ matches: true } as MediaQueryListEvent);
    });
    expect(document.documentElement).toHaveClass("dark");
  });

  it("honours a stored theme preference over the OS preference", () => {
    localStorage.setItem(
      "user-preferences",
      JSON.stringify({ state: { theme: "light" }, version: 0 }),
    );
    useUserPreferencesStore.setState({ theme: "light" });
    render(<PortalApplicationProviders>{null}</PortalApplicationProviders>);
    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
