import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScimTokenSettings } from "./scim-token-settings";

const apiFetch = vi.fn();
vi.mock("@taskdesk/libs", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://api.test/${path}`,
}));

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ScimTokenSettings", () => {
  beforeEach(() => apiFetch.mockReset());
  afterEach(cleanup);

  it("binds issue-or-rotate to connection/version and displays the returned bearer once", async () => {
    const onConfigurationChanged = vi.fn();
    apiFetch
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: "challenge", nonce: "nonce" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: "step-up-proof" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          configVersion: 8,
          token: "new-one-time-scim-bearer",
          tokenRotatedAt: "2026-10-04T12:00:00.000Z",
        }),
      );

    render(
      <ScimTokenSettings
        configVersion={7}
        connectionId="connection/one"
        enabled
        onConfigurationChanged={onConfigurationChanged}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Token operation password"), {
      target: { value: "example-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Issue or rotate token" }),
    );

    await screen.findByDisplayValue("new-one-time-scim-bearer");
    expect(apiFetch).toHaveBeenCalledTimes(3);
    const requests = apiFetch.mock.calls.map(([url, init]) => ({
      url: String(url),
      init: init as RequestInit,
    }));
    const binding = {
      kind: "operation",
      operation: "scim_token_rotate",
      connectionId: "connection/one",
      version: 7,
    };
    expect(requests[0]?.url).toBe("https://api.test/me/step-up/challenges");
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual(binding);
    expect(requests[1]?.url).toBe("https://api.test/me/step-up");
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
      ...binding,
      challengeId: "challenge",
      nonce: "nonce",
      method: "password",
      password: "example-password",
    });
    expect(requests[2]?.url).toBe(
      "https://api.test/instance/identity-connections/connection%2Fone/scim/rotate-token",
    );
    expect(requests[2]?.init.method).toBe("POST");
    expect(JSON.parse(String(requests[2]?.init.body))).toEqual({ version: 7 });
    expect(
      new Headers(requests[2]?.init.headers).get("x-taskdesk-step-up-token"),
    ).toBe("step-up-proof");
    expect(onConfigurationChanged).toHaveBeenCalledWith(8, false);
    expect(screen.getByText(/shown once below/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy token" })).toBeTruthy();
    expect(screen.getByLabelText("Token operation password")).toHaveValue("");
  });

  it("uses a distinct revoke binding and exposes only the safe result", async () => {
    const onConfigurationChanged = vi.fn();
    apiFetch
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: "challenge", nonce: "nonce" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: "step-up-proof" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { configVersion: 8, revoked: true }),
      );

    render(
      <ScimTokenSettings
        configVersion={7}
        connectionId="connection-one"
        enabled
        onConfigurationChanged={onConfigurationChanged}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Token operation password"), {
      target: { value: "example-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revoke token" }));

    await screen.findByText(/bearer was revoked/u);
    const body = JSON.parse(String(apiFetch.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      kind: "operation",
      operation: "scim_token_revoke",
      connectionId: "connection-one",
      version: 7,
    });
    expect(String(apiFetch.mock.calls[2]?.[0])).toBe(
      "https://api.test/instance/identity-connections/connection-one/scim/revoke-token",
    );
    expect(JSON.parse(String(apiFetch.mock.calls[2]?.[1]?.body))).toEqual({
      version: 7,
    });
    expect(onConfigurationChanged).toHaveBeenCalledWith(8, false);
    expect(screen.queryByLabelText("New token — copy it now")).toBeNull();
  });

  it("re-enables SCIM through the settings PATCH after the upstream token is updated", async () => {
    const onConfigurationChanged = vi.fn();
    apiFetch
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: "challenge", nonce: "nonce" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: "step-up-proof" }))
      .mockResolvedValueOnce(jsonResponse(200, { data: {}, configVersion: 7 }));

    render(
      <ScimTokenSettings
        configVersion={6}
        connectionId="connection-one"
        enabled={false}
        onConfigurationChanged={onConfigurationChanged}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Token operation password"), {
      target: { value: "example-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Re-enable SCIM" }));

    await screen.findByText("SCIM is enabled with the current bearer token.");
    const binding = {
      kind: "operation",
      operation: "scim_admin_update",
      connectionId: "connection-one",
      request: { configVersion: 6, kind: "settings", enabled: true },
    };
    expect(JSON.parse(String(apiFetch.mock.calls[0]?.[1]?.body))).toEqual(
      binding,
    );
    expect(apiFetch.mock.calls[2]?.[0]).toBe(
      "https://api.test/instance/identity-connections/connection-one/scim",
    );
    expect(apiFetch.mock.calls[2]?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(apiFetch.mock.calls[2]?.[1]?.body))).toEqual(
      binding.request,
    );
    expect(
      new Headers(apiFetch.mock.calls[2]?.[1]?.headers).get(
        "x-taskdesk-step-up-token",
      ),
    ).toBe("step-up-proof");
    expect(onConfigurationChanged).toHaveBeenCalledWith(7, true);
  });

  it("keeps stale-version failures recoverable without claiming a token changed", async () => {
    const onReload = vi.fn();
    apiFetch
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: "challenge", nonce: "nonce" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: "step-up-proof" }))
      .mockResolvedValueOnce(
        jsonResponse(409, { message: "version_conflict" }),
      );
    render(
      <ScimTokenSettings
        configVersion={7}
        connectionId="connection-one"
        enabled
        onConfigurationChanged={vi.fn()}
        onReload={onReload}
      />,
    );
    fireEvent.change(screen.getByLabelText("Token operation password"), {
      target: { value: "example-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Issue or rotate token" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Reload latest settings" }),
    );
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("SCIM token updated")).toBeNull();
    expect(screen.queryByLabelText("New token — copy it now")).toBeNull();
  });
});
