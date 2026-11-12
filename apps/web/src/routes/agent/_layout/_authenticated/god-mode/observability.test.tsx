import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  t: (key: string) => `translated:${key}`,
  fetch: vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes("local-factor-policy")
        ? { policy: { mode: "optional", requiredRoleId: null } }
        : {
            version: 1,
            logLevels: { default: "info", modules: {} },
            metricsTokenConfigured: false,
            metricsTokenRotatedAt: null,
          },
  })),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) =>
    config.component,
}));
vi.mock("@taskdesk/libs", () => ({ apiFetch: mocks.fetch }));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => path,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t }),
  Trans: ({ i18nKey }: { i18nKey: string }) => `translated:${i18nKey}`,
}));

import { Route } from "./observability";

beforeEach(() => {
  mocks.fetch.mockClear();
});

afterEach(() => {
  cleanup();
  mocks.t = (key: string) => `translated:${key}`;
});

describe("observability translations", () => {
  it("uses translations for the loaded controls and status", async () => {
    const Component = Route as unknown as React.ComponentType;
    const { container } = render(<Component />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("translated:observability.factorPolicy"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "translated:observability.saveLevels",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("translated:observability.notConfigured"),
    ).toBeInTheDocument();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const renderedText: string[] = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      if (text) renderedText.push(text);
    }
    expect(renderedText.length).toBeGreaterThan(0);
    expect(renderedText.every((text) => text.startsWith("translated:"))).toBe(
      true,
    );
    expect(screen.queryByText("Local factor policy")).not.toBeInTheDocument();
    expect(screen.queryByText("Save log levels")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No token is configured."),
    ).not.toBeInTheDocument();
  });

  it("does not reload settings when the translation function changes", async () => {
    const Component = Route as unknown as React.ComponentType;
    const { rerender } = render(<Component />);
    await screen.findByText("translated:observability.factorPolicy");
    mocks.t = (key: string) => `new-language:${key}`;
    rerender(<Component />);
    expect(
      screen.getByText("new-language:observability.factorPolicy"),
    ).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
