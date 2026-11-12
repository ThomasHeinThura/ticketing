import de from "@i18n/de-DE.json";
import { fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) =>
    config.component,
}));
vi.mock("@taskdesk/libs", () => ({ apiFetch: mocks.fetch }));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => path,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));

import { Route } from "./observability";

const rotated = "2026-10-13T08:24:00.000Z";
const settings = {
  version: 1,
  logLevels: { default: "info", modules: {} },
  metricsTokenConfigured: true,
  metricsTokenRotatedAt: rotated,
};

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function setup() {
  const instance = createInstance();
  const translated = structuredClone(de);
  translated.godModeSettings.observability.requiredAudience =
    "Erforderliche Zielgruppe";
  translated.godModeSettings.observability.factorProofType =
    "Art des Faktornachweises";
  translated.godModeSettings.observability.conflict =
    "Die Einstellungen wurden geändert.";
  translated.godModeSettings.observability.copyToken =
    "<strong>Token jetzt kopieren.</strong> Es wird nicht erneut angezeigt.";
  await instance.use(initReactI18next).init({
    lng: "de-DE",
    resources: { "de-DE": translated },
    interpolation: { escapeValue: false },
  });
  mocks.fetch
    .mockReset()
    .mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "instance/local-factor-policy")
        return response({ policy: { mode: "optional", requiredRoleId: null } });
      if (url === "instance/observability" && init?.method === "PATCH")
        return response({}, 409);
      if (url === "instance/observability") return response(settings);
      if (url === "me/step-up/challenges")
        return response({ challengeId: "challenge", nonce: "nonce" });
      if (url === "me/step-up") return response({ token: "proof" });
      if (url === "instance/observability/metrics-token/rotate")
        return response({
          version: 2,
          token: "one-time-token",
          metricsTokenRotatedAt: rotated,
        });
      throw new Error(`Unexpected request ${url}`);
    });
  const Component = Route as unknown as React.ComponentType;
  render(
    <I18nextProvider i18n={instance}>
      <Component />
    </I18nextProvider>,
  );
  await screen.findByRole("heading", {
    name: de.godModeSettings.observability.factorPolicy,
  });
  return instance;
}

describe("observability with a real locale", () => {
  it("uses the selected locale in accessible labels and the rotation timestamp", async () => {
    await setup();
    expect(
      screen.getByRole("combobox", {
        name: "Erforderliche Zielgruppe",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", {
        name: "Art des Faktornachweises",
      }),
    ).toBeInTheDocument();
    const expected = new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(rotated));
    const browserOrder = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(rotated));
    expect(expected).not.toBe(browserOrder);
    expect(screen.getByRole("status")).toHaveTextContent(expected);
  });

  it("shows a translated conflict and the emphasized one-time-token warning", async () => {
    await setup();
    fireEvent.click(
      screen.getByRole("button", {
        name: de.godModeSettings.observability.saveLevels,
      }),
    );
    expect(
      await screen.findByText("Die Einstellungen wurden geändert."),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText(de.instanceUsers.copy["19dff4dad0a7"]),
      {
        target: { value: "password" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: de.godModeSettings.observability.verifyPassword,
      }),
    );
    expect(await screen.findByText("one-time-token")).toBeInTheDocument();
    const emphasized = screen.getByText("Token jetzt kopieren.");
    expect(emphasized.tagName).toBe("STRONG");
    expect(emphasized.parentElement).toHaveTextContent(
      "Token jetzt kopieren. Es wird nicht erneut angezeigt.",
    );
  });
});
