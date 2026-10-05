import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScimMatchAttributesSettings } from "./scim-match-attributes-settings";

const apiFetch = vi.fn();

vi.mock("@taskdesk/libs", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://api.test/${path}`,
}));

const config = (
  configVersion = 4,
  matchAttributes = ["externalId", "userName"],
  allowedResources = ["users"],
  lifecyclePolicy: "end_memberships" | "keep_memberships" = "end_memberships",
) => ({
  data: {
    enabled: true,
    allowedResources,
    lifecyclePolicy,
    matchAttributes,
    attributeMapping: {
      version: 1,
      name: "displayName",
      email: "userName",
      jobTitle: "unmapped",
      locale: "unmapped",
    },
    mappings: [],
  },
  configVersion,
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pickOption(option: HTMLElement) {
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

describe("ScimMatchAttributesSettings", () => {
  beforeEach(() => apiFetch.mockReset());
  afterEach(cleanup);

  it("binds SCIM settings step-up and save to the exact connection, version, and draft", async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse(200, config()))
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: "challenge", nonce: "nonce" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: "proof" }))
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          config(
            5,
            ["externalId", "userName", "title"],
            ["users", "groups"],
            "keep_memberships",
          ),
        ),
      );

    render(<ScimMatchAttributesSettings connectionId="connection/one" />);
    const title = await screen.findByRole("checkbox", { name: "title" });
    fireEvent.click(title);
    fireEvent.click(screen.getByRole("checkbox", { name: "Groups" }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "User deactivation policy" }),
    );
    pickOption(
      await screen.findByRole("option", { name: "Keep sourced memberships" }),
    );
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save SCIM settings" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(4));
    const requests = apiFetch.mock.calls.map(([url, init]) => ({
      url: String(url),
      init: init as RequestInit,
    }));
    const binding = {
      kind: "operation",
      operation: "scim_admin_update",
      connectionId: "connection/one",
      request: {
        configVersion: 4,
        kind: "settings",
        allowedResources: ["users", "groups"],
        lifecyclePolicy: "keep_memberships",
        matchAttributes: ["externalId", "userName", "title"],
      },
    };
    expect(requests[1]?.url).toBe("https://api.test/me/step-up/challenges");
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual(binding);
    expect(requests[2]?.url).toBe("https://api.test/me/step-up");
    expect(JSON.parse(String(requests[2]?.init.body))).toEqual({
      ...binding,
      challengeId: "challenge",
      nonce: "nonce",
      method: "password",
      password: "correct horse",
    });
    expect(requests[3]?.url).toBe(
      "https://api.test/instance/identity-connections/connection%2Fone/scim",
    );
    expect(requests[3]?.init.method).toBe("PATCH");
    expect(JSON.parse(String(requests[3]?.init.body))).toEqual(binding.request);
    expect(
      new Headers(requests[3]?.init.headers).get("x-taskdesk-step-up-token"),
    ).toBe("proof");
    expect(screen.getByText("Configuration version 5")).toBeTruthy();
  });

  it("keeps the draft on a stale version and offers an explicit reload", async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse(200, config()))
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: "challenge", nonce: "nonce" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: "proof" }))
      .mockResolvedValueOnce(jsonResponse(409, { error: "conflict" }))
      .mockResolvedValueOnce(
        jsonResponse(200, config(5, ["externalId", "userName", "title"])),
      );

    render(<ScimMatchAttributesSettings connectionId="connection-one" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "title" }));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save SCIM settings" }));

    const reload = await screen.findByRole("button", {
      name: "Reload latest settings",
    });
    expect(screen.getByRole("checkbox", { name: "title" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(reload);
    await waitFor(() =>
      expect(screen.getByText("Configuration version 5")).toBeTruthy(),
    );
  });

  it("saves the closed profile-only attribute map with connection-bound step-up", async () => {
    const changedMapping = {
      version: 1 as const,
      name: "name.formatted" as const,
      email: "userName" as const,
      jobTitle: "unmapped" as const,
      locale: "unmapped" as const,
    };
    const updated = {
      ...config(5),
      data: { ...config(5).data, attributeMapping: changedMapping },
    };
    apiFetch
      .mockResolvedValueOnce(jsonResponse(200, config()))
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: "challenge", nonce: "nonce" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: "proof" }))
      .mockResolvedValueOnce(jsonResponse(200, updated))
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: "challenge-2", nonce: "nonce-2" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: "proof-2" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ...updated,
          configVersion: 6,
          data: {
            ...updated.data,
            matchAttributes: ["externalId", "userName", "title"],
          },
        }),
      );

    render(<ScimMatchAttributesSettings connectionId="connection/one" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "title" }));
    fireEvent.click(
      await screen.findByRole("combobox", { name: "Display name source" }),
    );
    pickOption(await screen.findByRole("option", { name: "name.formatted" }));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save profile mapping" }),
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(4));
    const request = {
      configVersion: 4,
      kind: "attribute_mapping",
      attributeMapping: changedMapping,
    };
    expect(JSON.parse(String(apiFetch.mock.calls[1]?.[1]?.body))).toEqual({
      kind: "operation",
      operation: "scim_admin_update",
      connectionId: "connection/one",
      request,
    });
    expect(apiFetch.mock.calls[3]?.[0]).toBe(
      "https://api.test/instance/identity-connections/connection%2Fone/scim",
    );
    expect(apiFetch.mock.calls[3]?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(apiFetch.mock.calls[3]?.[1]?.body))).toEqual(
      request,
    );
    expect(screen.getByText("Configuration version 5")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "title" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save SCIM settings" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(7));
    expect(JSON.parse(String(apiFetch.mock.calls[4]?.[1]?.body))).toEqual({
      kind: "operation",
      operation: "scim_admin_update",
      connectionId: "connection/one",
      request: {
        configVersion: 5,
        kind: "settings",
        matchAttributes: ["externalId", "userName", "title"],
      },
    });
    expect(screen.getByText("Configuration version 6")).toBeTruthy();
  });
});
