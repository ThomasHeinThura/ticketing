import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/god-mode/authentication";
const apiFetch = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Outlet: () => <div data-testid="identity-connection-outlet" />,
  useLocation: () => ({ pathname }),
}));
vi.mock("@taskdesk/libs", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://api.test/${path}`,
}));

import { Route } from "./authentication";

const IdentityConnectionsRoute = (
  Route as unknown as { component: ComponentType }
).component;

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
  pathname = "/god-mode/authentication";
});

describe("God Mode identity connection list", () => {
  it("shows safe connection metadata and links to the registered editor URL", async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "connection/one",
              providerType: "entra",
              portalScope: "agent",
              organisationId: null,
              defaultWorkspaceId: null,
              displayName: "Staff directory",
              enabled: true,
              configVersion: 3,
              clientSecretConfigured: true,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(<IdentityConnectionsRoute />);

    const link = await screen.findByRole("link", { name: "SCIM settings" });
    expect(link).toHaveAttribute(
      "href",
      "/god-mode/authentication/connection%2Fone",
    );
    expect(screen.getByText(/Staff portal/u)).toBeTruthy();
    expect(screen.queryByText(/clientSecret|secretConfigured/u)).toBeNull();
  });

  it("renders the nested editor without refetching the connection list", () => {
    pathname = "/god-mode/authentication/connection-one";
    render(<IdentityConnectionsRoute />);
    expect(screen.getByTestId("identity-connection-outlet")).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
