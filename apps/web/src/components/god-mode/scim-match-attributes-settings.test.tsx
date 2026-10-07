import enUS from "@i18n/en-US.json";
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

vi.mock("react-i18next", () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    const [namespace, path] = key.includes(":")
      ? key.split(":")
      : ["identityConnections", key];
    const source = path
      .split(".")
      .reduce<unknown>(
        (current, part) =>
          (current as Record<string, unknown> | undefined)?.[part],
        (enUS as Record<string, unknown>)[namespace ?? "identityConnections"],
      );
    if (typeof source !== "string") return key;
    return source.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
      String(options?.[name] ?? `{{${name}}}`),
    );
  };
  return {
    useTranslation: () => ({ i18n: { language: "en-US" }, t }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});
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

const emptyMappingOptions = {
  kind: "agent_targets",
  data: [],
  nextCursor: null,
};

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

function expectMappingOptionsCall(callIndex: number, connectionId: string) {
  const [url, init] = apiFetch.mock.calls[callIndex] ?? [];
  expect(url).toBe(
    `https://api.test/instance/identity-connections/${encodeURIComponent(connectionId)}/scim/mapping-options?limit=100`,
  );
  expect((init as RequestInit | undefined)?.credentials).toBe("include");
  expect((init as RequestInit | undefined)?.cache).toBe("no-store");
}

describe("ScimMatchAttributesSettings", () => {
  beforeEach(() => apiFetch.mockReset());
  afterEach(cleanup);

  it("binds SCIM settings step-up and save to the exact connection, version, and draft", async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse(200, config()))
      .mockResolvedValueOnce(jsonResponse(200, emptyMappingOptions))
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
    fireEvent.change(
      screen.getByLabelText("Password", { selector: "#scim-step-up-secret" }),
      {
        target: { value: "correct horse" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save SCIM settings" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(5));
    expectMappingOptionsCall(1, "connection/one");
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
    expect(requests[2]?.url).toBe("https://api.test/me/step-up/challenges");
    expect(JSON.parse(String(requests[2]?.init.body))).toEqual(binding);
    expect(requests[3]?.url).toBe("https://api.test/me/step-up");
    expect(JSON.parse(String(requests[3]?.init.body))).toEqual({
      ...binding,
      challengeId: "challenge",
      nonce: "nonce",
      method: "password",
      password: "correct horse",
    });
    expect(requests[4]?.url).toBe(
      "https://api.test/instance/identity-connections/connection%2Fone/scim",
    );
    expect(requests[4]?.init.method).toBe("PATCH");
    expect(JSON.parse(String(requests[4]?.init.body))).toEqual(binding.request);
    expect(
      new Headers(requests[4]?.init.headers).get("x-taskdesk-step-up-token"),
    ).toBe("proof");
    expect(screen.getByText("Configuration version 5")).toBeTruthy();
  });

  it("keeps the draft on a stale version and offers an explicit reload", async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse(200, config()))
      .mockResolvedValueOnce(jsonResponse(200, emptyMappingOptions))
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
    fireEvent.change(
      screen.getByLabelText("Password", { selector: "#scim-step-up-secret" }),
      {
        target: { value: "secret" },
      },
    );
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
    expectMappingOptionsCall(1, "connection-one");
    expect(apiFetch).toHaveBeenCalledTimes(7);
    expect(apiFetch.mock.calls[4]?.[0]).toBe(
      "https://api.test/instance/identity-connections/connection-one/scim",
    );
    expect(apiFetch.mock.calls[4]?.[1]?.method).toBe("PATCH");
    expect(apiFetch.mock.calls[5]?.[0]).toBe(
      "https://api.test/instance/identity-connections/connection-one/scim",
    );
    expectMappingOptionsCall(6, "connection-one");
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
      .mockResolvedValueOnce(jsonResponse(200, emptyMappingOptions))
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
    fireEvent.change(
      screen.getByLabelText("Password", { selector: "#scim-step-up-secret" }),
      {
        target: { value: "correct horse" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save profile mapping" }),
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(5));
    expectMappingOptionsCall(1, "connection/one");
    const request = {
      configVersion: 4,
      kind: "attribute_mapping",
      attributeMapping: changedMapping,
    };
    expect(JSON.parse(String(apiFetch.mock.calls[2]?.[1]?.body))).toEqual({
      kind: "operation",
      operation: "scim_admin_update",
      connectionId: "connection/one",
      request,
    });
    expect(apiFetch.mock.calls[4]?.[0]).toBe(
      "https://api.test/instance/identity-connections/connection%2Fone/scim",
    );
    expect(apiFetch.mock.calls[4]?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(apiFetch.mock.calls[4]?.[1]?.body))).toEqual(
      request,
    );
    expect(screen.getByText("Configuration version 5")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "title" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.change(
      screen.getByLabelText("Password", { selector: "#scim-step-up-secret" }),
      {
        target: { value: "correct horse" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save SCIM settings" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(8));
    expect(JSON.parse(String(apiFetch.mock.calls[5]?.[1]?.body))).toEqual({
      kind: "operation",
      operation: "scim_admin_update",
      connectionId: "connection/one",
      request: {
        configVersion: 5,
        kind: "settings",
        matchAttributes: ["externalId", "userName", "title"],
      },
    });
    expect(JSON.parse(String(apiFetch.mock.calls[6]?.[1]?.body))).toEqual({
      kind: "operation",
      operation: "scim_admin_update",
      connectionId: "connection/one",
      request: {
        configVersion: 5,
        kind: "settings",
        matchAttributes: ["externalId", "userName", "title"],
      },
      challengeId: "challenge-2",
      nonce: "nonce-2",
      method: "password",
      password: "correct horse",
    });
    expect(apiFetch.mock.calls[7]?.[0]).toBe(
      "https://api.test/instance/identity-connections/connection%2Fone/scim",
    );
    expect(apiFetch.mock.calls[7]?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(apiFetch.mock.calls[7]?.[1]?.body))).toEqual({
      configVersion: 5,
      kind: "settings",
      matchAttributes: ["externalId", "userName", "title"],
    });
    expect(screen.getByText("Configuration version 6")).toBeTruthy();
  });
});
