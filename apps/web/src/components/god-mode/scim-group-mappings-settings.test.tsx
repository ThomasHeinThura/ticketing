import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScimGroupMappingsSettings } from "./scim-group-mappings-settings";

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

function pickOption(option: HTMLElement) {
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

const targetOptions = {
  kind: "agent_targets",
  data: [{ id: "workspace-one", name: "Support workspace" }],
  nextCursor: null,
};
const roleOptions = {
  kind: "agent_roles",
  target: { id: "workspace-one", name: "Support workspace" },
  data: [{ id: "role-one", name: "Responder", rank: 3 }],
  nextCursor: null,
};

describe("ScimGroupMappingsSettings", () => {
  beforeEach(() => apiFetch.mockReset());
  afterEach(cleanup);

  it("creates a mapping using eligible selectors and the exact shared PA-15 binding", async () => {
    const onReload = vi.fn();
    apiFetch
      .mockResolvedValueOnce(jsonResponse(200, targetOptions))
      .mockResolvedValueOnce(jsonResponse(200, roleOptions))
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: "challenge-one", nonce: "nonce-one" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: "step-up-token" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          configVersion: 5,
          data: { mappings: [] },
        }),
      );

    render(
      <ScimGroupMappingsSettings
        configVersion={4}
        connectionId="connection-one"
        mappings={[]}
        onReload={onReload}
      />,
    );
    fireEvent.change(
      await screen.findByLabelText("External group identifier"),
      {
        target: { value: "entra-group-1" },
      },
    );
    fireEvent.change(screen.getByLabelText("Display name (optional)"), {
      target: { value: "Service desk" },
    });
    fireEvent.click(
      screen.getByRole("combobox", { name: "Internal workspace" }),
    );
    pickOption(
      await screen.findByRole("option", { name: "Support workspace" }),
    );
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("combobox", { name: "Eligible role" }));
    pickOption(
      await screen.findByRole("option", { name: "Responder · rank 3" }),
    );
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create mapping" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(5));
    const calls = apiFetch.mock.calls.map(([url, init]) => ({
      url: String(url),
      init: init as RequestInit,
    }));
    const request = {
      configVersion: 4,
      kind: "mapping_create",
      externalGroupId: "entra-group-1",
      externalGroupNameSnapshot: "Service desk",
      roleId: "role-one",
      scope: "workspace",
      scopeId: "workspace-one",
      enabled: true,
    };
    const binding = {
      kind: "operation",
      operation: "scim_admin_update",
      connectionId: "connection-one",
      request,
    };
    expect(String(calls[0]?.url)).toContain("/mapping-options?limit=100");
    expect(String(calls[1]?.url)).toContain("workspaceId=workspace-one");
    expect(JSON.parse(String(calls[2]?.init.body))).toEqual(binding);
    expect(JSON.parse(String(calls[3]?.init.body))).toEqual({
      ...binding,
      challengeId: "challenge-one",
      nonce: "nonce-one",
      method: "password",
      password: "correct horse",
    });
    expect(calls[4]?.url).toBe(
      "https://api.test/instance/identity-connections/connection-one/scim",
    );
    expect(calls[4]?.init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[4]?.init.body))).toEqual(request);
    expect(
      new Headers(calls[4]?.init.headers).get("x-taskdesk-step-up-token"),
    ).toBe("step-up-token");
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("updates and disables an existing mapping while preserving its draft on a stale CAS", async () => {
    const mapping = {
      id: "mapping-one",
      externalGroupId: "entra-group-one",
      externalGroupNameSnapshot: "Old label",
      roleId: "role-one",
      scope: "workspace" as const,
      scopeId: "workspace-one",
      enabled: true,
    };
    apiFetch
      .mockResolvedValueOnce(jsonResponse(200, targetOptions))
      .mockResolvedValueOnce(jsonResponse(200, roleOptions))
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: "challenge-two", nonce: "nonce-two" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: "proof-two" }))
      .mockResolvedValueOnce(
        jsonResponse(409, { title: "Configuration changed", status: 409 }),
      );

    render(
      <ScimGroupMappingsSettings
        configVersion={7}
        connectionId="connection-one"
        mappings={[mapping]}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit mapping" }),
    );
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText("Display name (optional)"), {
      target: { value: "New label" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mapping enabled" }));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));

    await screen.findByText(
      "SCIM settings changed in another session. Your draft is preserved; reload before retrying.",
    );
    expect(screen.getByLabelText("Display name (optional)")).toHaveValue(
      "New label",
    );
    const patchCall = apiFetch.mock.calls[4];
    if (!patchCall) throw new Error("Expected a mapping PATCH request");
    expect(patchCall[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String((patchCall[1] as RequestInit).body))).toEqual({
      configVersion: 7,
      kind: "mapping_update",
      mappingId: "mapping-one",
      externalGroupNameSnapshot: "New label",
      roleId: "role-one",
      scopeId: "workspace-one",
      enabled: false,
    });
  });
});
