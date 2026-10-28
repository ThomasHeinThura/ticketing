import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  intent: vi.fn(),
  start: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) =>
      translate(key, options),
  }),
}));

vi.mock("@/fetchers/identity-links", () => ({
  getIdentityLinks: (...args: unknown[]) => mocks.list(...args),
  getIdentityLinkIntent: (...args: unknown[]) => mocks.intent(...args),
  startIdentityLink: (...args: unknown[]) => mocks.start(...args),
  confirmIdentityLink: (...args: unknown[]) => mocks.confirm(...args),
}));

import {
  ConnectedAccountsPanel,
  identityLinkAuthorizationUrl,
} from "./connected-accounts-panel";

const id = "i".repeat(43);

function renderPanel(intentId?: string) {
  const onClearIntent = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ConnectedAccountsPanel
        intentId={intentId}
        onClearIntent={onClearIntent}
      />
    </QueryClientProvider>,
  );
  return { onClearIntent };
}

beforeEach(() => {
  mocks.list.mockReset();
  mocks.intent.mockReset();
  mocks.start.mockReset();
  mocks.confirm.mockReset();
});
afterEach(cleanup);

describe("ConnectedAccountsPanel", () => {
  it("explains why a password session cannot link an identity provider", async () => {
    mocks.list.mockRejectedValue(new HttpError(403, "forbidden"));
    renderPanel();

    expect(
      await screen.findByText(
        translate("auth:accountSecurity.identityLinks.passwordSession"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: translate("auth:accountSecurity.identityLinks.linkAction"),
      }),
    ).not.toBeInTheDocument();
  });

  it("requires explicit confirmation, then clears the intent after the API confirms", async () => {
    mocks.list.mockResolvedValue({
      source: { connectionId: "source", displayName: "Work SSO" },
      targets: [],
    });
    mocks.intent.mockResolvedValue({
      intentId: id,
      sourceDisplayName: "Work SSO",
      targetDisplayName: "Second SSO",
      accountLabel: "alex@example.test",
      displayName: "Alex Example",
      expiresAt: "2026-10-26T12:00:00.000Z",
    });
    mocks.confirm.mockResolvedValue({ linked: true, alreadyLinked: false });
    const { onClearIntent } = renderPanel(id);

    expect(
      await screen.findByText(
        translate("auth:accountSecurity.identityLinks.confirmDescription", {
          displayName: "Alex Example",
          accountLabel: "alex@example.test",
          targetDisplayName: "Second SSO",
          sourceDisplayName: "Work SSO",
        }),
      ),
    ).toBeInTheDocument();
    expect(mocks.confirm).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: translate("auth:accountSecurity.identityLinks.confirmButton"),
      }),
    );

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(id));
    expect(onClearIntent).toHaveBeenCalledTimes(1);
  });

  it("cancel removes the intent without confirming", async () => {
    mocks.list.mockResolvedValue({
      source: { connectionId: "s", displayName: "A" },
      targets: [],
    });
    mocks.intent.mockResolvedValue({
      intentId: id,
      sourceDisplayName: "A",
      targetDisplayName: "B",
      accountLabel: "account",
      displayName: "Person",
      expiresAt: "2026-10-26T12:00:00.000Z",
    });
    const { onClearIntent } = renderPanel(id);
    fireEvent.click(
      await screen.findByRole("button", {
        name: translate("auth:accountSecurity.identityLinks.cancel"),
      }),
    );

    expect(onClearIntent).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});

describe("identityLinkAuthorizationUrl", () => {
  it("accepts only absolute HTTPS provider URLs without credentials or fragments", () => {
    expect(
      identityLinkAuthorizationUrl(
        "https://idp.example.test/authorize?state=opaque",
      ),
    ).toBe("https://idp.example.test/authorize?state=opaque");
    for (const value of [
      "javascript:alert(1)",
      "http://idp.example.test/authorize",
      "https://user:pass@idp.example.test/authorize",
      "https://idp.example.test/authorize#fragment",
    ]) {
      expect(() => identityLinkAuthorizationUrl(value)).toThrow(
        "Invalid identity provider authorization URL",
      );
    }
  });
});
