import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityAdminError } from "@/fetchers/god-mode/identity-admin-error";
import type { ScimAdminSettings } from "@/fetchers/god-mode/identity-connections";
import {
  chooseOption,
  renderWithQuery,
  scimSettings,
} from "@/test/identity-test-harness";
import { ScimPanel } from "./scim-panel";

const mocks = vi.hoisted(() => ({
  prove: vi.fn(),
  getScim: vi.fn(),
  patchScim: vi.fn(),
  rotate: vi.fn(),
  revoke: vi.fn(),
  options: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const { translate } = await import("@/test/en-translation");
  return {
    useTranslation: (namespace: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translate(`${namespace}:${key}`, options),
      i18n: { language: "en-US" },
    }),
  };
});
vi.mock("@/fetchers/god-mode/identity-step-up", () => ({
  proveIdentityOperation: (...args: unknown[]) => mocks.prove(...args),
}));
vi.mock("@/fetchers/god-mode/instance-users", () => ({
  getCurrentFactorStatus: async () => ({ enabled: true }),
}));
vi.mock("@/fetchers/god-mode/identity-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/god-mode/identity-connections")
  >()),
  getScimAdminSettings: (...args: unknown[]) => mocks.getScim(...args),
  patchScimAdmin: (...args: unknown[]) => mocks.patchScim(...args),
  rotateScimBearer: (...args: unknown[]) => mocks.rotate(...args),
  revokeScimBearer: (...args: unknown[]) => mocks.revoke(...args),
  getScimMappingOptions: (...args: unknown[]) => mocks.options(...args),
}));

const BEARER = "b".repeat(43);

function updated(patch: Partial<ScimAdminSettings["data"]>): ScimAdminSettings {
  return {
    configVersion: scimSettings.configVersion + 1,
    data: { ...scimSettings.data, ...patch },
  };
}

beforeEach(() => {
  mocks.prove.mockResolvedValue("proof-token");
  mocks.getScim.mockResolvedValue(scimSettings);
  mocks.options.mockImplementation(async (_id: string, workspaceId?: string) =>
    workspaceId
      ? {
          kind: "agent_roles",
          target: { id: workspaceId, name: "Operations" },
          data: [{ id: "role-2", name: "Agent", rank: 3 }],
          nextCursor: null,
        }
      : {
          kind: "agent_targets",
          data: [{ id: "ws-1", name: "Operations" }],
          nextCursor: null,
        },
  );
  mocks.rotate.mockImplementation(async (input: { version: number }) => ({
    configVersion: input.version + 1,
    token: BEARER,
    tokenRotatedAt: "2026-10-15T10:00:00.000Z",
  }));
  mocks.revoke.mockImplementation(async (input: { version: number }) => ({
    configVersion: input.version + 1,
    revoked: true,
  }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPanel(openMapping?: string) {
  const onOpenMapping = vi.fn();
  const view = renderWithQuery(
    <ScimPanel
      connectionId="conn-1"
      onOpenMapping={onOpenMapping}
      openMapping={openMapping}
    />,
  );
  await screen.findByRole("heading", { name: "SCIM provisioning" });
  return { onOpenMapping, ...view };
}

async function enterCode(value = "123456") {
  fireEvent.change(await screen.findByLabelText("Authenticator code"), {
    target: { value },
  });
}

describe("ScimPanel states", () => {
  it("shows a loading state, then the settings", async () => {
    await renderPanel();
    expect(
      screen.getByText("SCIM is disabled", { selector: "p" }),
    ).toBeInTheDocument();
    // Test builds have no VITE_API_URL, so the API origin falls back to the dev default.
    expect(
      screen.getByText("http://localhost:1337/scim/v2"),
    ).toBeInTheDocument();
  });

  it("explains denied access and offers no retry-less dead end for other failures", async () => {
    mocks.getScim.mockRejectedValue(
      new IdentityAdminError(403, "x", "Forbidden", null),
    );
    renderWithQuery(
      <ScimPanel
        connectionId="conn-1"
        onOpenMapping={vi.fn()}
        openMapping={undefined}
      />,
    );
    await screen.findByText("SCIM settings unavailable");
    expect(
      screen.getByText(/instance administrator access/u),
    ).toBeInTheDocument();
    cleanup();
    mocks.getScim.mockRejectedValue(new IdentityAdminError(503, "x", "", null));
    renderWithQuery(
      <ScimPanel
        connectionId="conn-1"
        onOpenMapping={vi.fn()}
        openMapping={undefined}
      />,
    );
    await screen.findByText(
      /stored SCIM configuration is invalid/u,
      {},
      { timeout: 4000 },
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("SCIM settings", () => {
  it("saves one settings request with only the changed settings bound to proof and write", async () => {
    mocks.patchScim.mockResolvedValue(
      updated({
        allowedResources: ["users"],
        lifecyclePolicy: "keep_memberships",
      }),
    );
    await renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "Groups" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "displayName" }));
    await enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Save SCIM settings" }));
    await screen.findByText("SCIM settings were saved.");
    const request = {
      configVersion: 7,
      kind: "settings",
      allowedResources: ["users"],
      matchAttributes: ["externalId", "userName", "displayName"],
    };
    expect(mocks.prove).toHaveBeenCalledWith(
      { operation: "scim_admin_update", connectionId: "conn-1", request },
      { method: "totp", secret: "123456" },
    );
    expect(mocks.patchScim.mock.calls[0]?.[0]).toEqual({
      id: "conn-1",
      body: request,
      token: "proof-token",
    });
    expect(screen.getByLabelText("Authenticator code")).toHaveValue("");
  });

  it("disables Save until something changed and sends nothing without a factor", async () => {
    await renderPanel();
    expect(
      screen.getByRole("button", { name: "Save SCIM settings" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "title" }));
    fireEvent.click(screen.getByRole("button", { name: "Save SCIM settings" }));
    await screen.findByText(
      "Enter the selected verification factor to confirm this change.",
    );
    expect(mocks.prove).not.toHaveBeenCalled();
  });

  it("enabling without a token is reported truthfully and changes nothing", async () => {
    mocks.patchScim.mockRejectedValue(
      new IdentityAdminError(422, "x", "Invalid request", null),
    );
    await renderPanel();
    await enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Enable SCIM" }));
    await screen.findByText(
      "SCIM can only be enabled after a bearer token has been issued.",
    );
    expect(mocks.prove.mock.calls[0]?.[0].request).toEqual({
      configVersion: 7,
      kind: "settings",
      enabled: true,
    });
  });

  it("on a version conflict keeps the draft, names the current version and reloads on request", async () => {
    mocks.patchScim.mockRejectedValue(
      new IdentityAdminError(409, "x", "Version conflict", 12),
    );
    await renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "title" }));
    await enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Save SCIM settings" }));
    await screen.findByText(/now at version 12/u);
    expect(screen.getByRole("checkbox", { name: "title" })).toBeChecked();
    const calls = mocks.getScim.mock.calls.length;
    fireEvent.click(
      screen.getByRole("button", { name: "Reload latest settings" }),
    );
    await waitFor(() =>
      expect(mocks.getScim.mock.calls.length).toBeGreaterThan(calls),
    );
  });

  it("saves the profile mapping as its own attribute_mapping request", async () => {
    mocks.patchScim.mockResolvedValue(scimSettings);
    await renderPanel();
    await chooseOption(
      screen.getByRole("combobox", { name: "Job title source" }),
      "Not mapped",
    );
    await enterCode();
    fireEvent.click(
      screen.getByRole("button", { name: "Save profile mapping" }),
    );
    await waitFor(() => expect(mocks.prove).toHaveBeenCalled());
    expect(mocks.prove.mock.calls[0]?.[0].request).toEqual({
      configVersion: 7,
      kind: "attribute_mapping",
      attributeMapping: {
        ...scimSettings.data.attributeMapping,
        jobTitle: "unmapped",
      },
    });
  });
});

describe("SCIM bearer token", () => {
  it("shows a rotated bearer once, binds the version, and discards it on dismissal", async () => {
    await renderPanel();
    await enterCode();
    fireEvent.click(
      screen.getByRole("button", { name: "Issue or rotate token" }),
    );
    const field = await screen.findByLabelText("New bearer token");
    expect(field).toHaveValue(BEARER);
    expect(mocks.prove).toHaveBeenCalledWith(
      { operation: "scim_token_rotate", connectionId: "conn-1", version: 7 },
      { method: "totp", secret: "123456" },
    );
    expect(mocks.rotate.mock.calls[0]?.[0]).toMatchObject({
      id: "conn-1",
      version: 7,
      token: "proof-token",
    });
    expect(document.body.textContent).toContain("shown once");
    fireEvent.click(
      screen.getByRole("button", { name: "I have stored the token" }),
    );
    expect(screen.queryByDisplayValue(BEARER)).toBeNull();
    expect(window.location.href).not.toContain(BEARER);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(BEARER);
  });

  it("discards a shown bearer as soon as another SCIM change starts", async () => {
    mocks.patchScim.mockResolvedValue(scimSettings);
    await renderPanel();
    await enterCode();
    fireEvent.click(
      screen.getByRole("button", { name: "Issue or rotate token" }),
    );
    await screen.findByDisplayValue(BEARER);
    await enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Enable SCIM" }));
    await waitFor(() => expect(screen.queryByDisplayValue(BEARER)).toBeNull());
  });

  it("revokes with the revoke binding and reports a stale version without consuming anything", async () => {
    mocks.revoke.mockRejectedValue(
      new IdentityAdminError(409, "x", "version_conflict", 8),
    );
    await renderPanel();
    await enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Revoke token" }));
    await screen.findByText(/now at version 8/u);
    expect(mocks.prove).toHaveBeenCalledWith(
      { operation: "scim_token_revoke", connectionId: "conn-1", version: 7 },
      expect.anything(),
    );
    expect(screen.queryByText(/revoked and SCIM was disabled/u)).toBeNull();
  });

  it("reports a revoke with no token (422) as a rejected no-op", async () => {
    mocks.revoke.mockRejectedValue(
      new IdentityAdminError(422, "x", "Token operation unavailable", null),
    );
    await renderPanel();
    await enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Revoke token" }));
    await screen.findByText(/rejected as invalid, unchanged/u);
  });

  it("never stores the bearer in the mutation cache", async () => {
    const { client } = await renderPanel();
    await enterCode();
    fireEvent.click(
      screen.getByRole("button", { name: "Issue or rotate token" }),
    );
    await screen.findByDisplayValue(BEARER);
    const cached = JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state),
    );
    expect(cached).not.toContain(BEARER);
  });
});

describe("SCIM group mappings", () => {
  it("opens the add form from the URL state and creates an agent mapping", async () => {
    mocks.getScim.mockResolvedValue({
      ...scimSettings,
      data: { ...scimSettings.data, enabled: true },
    });
    mocks.patchScim.mockResolvedValue(scimSettings);
    const { onOpenMapping } = await renderPanel("new");
    fireEvent.change(await screen.findByLabelText("External group ID"), {
      target: { value: "group-9" },
    });
    fireEvent.click(await screen.findByRole("combobox", { name: "Workspace" }));
    fireEvent.click(await screen.findByRole("option", { name: "Operations" }));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Eligible role" }),
      ).not.toHaveAttribute("data-disabled"),
    );
    fireEvent.click(
      await screen.findByRole("combobox", { name: "Eligible role" }),
    );
    fireEvent.click(await screen.findByRole("option", { name: /Agent/u }));
    await enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Create mapping" }));
    await waitFor(() => expect(mocks.patchScim).toHaveBeenCalled());
    expect(mocks.prove.mock.calls[0]?.[0].request).toEqual({
      configVersion: 7,
      kind: "mapping_create",
      externalGroupId: "group-9",
      externalGroupNameSnapshot: null,
      roleId: "role-2",
      scope: "workspace",
      scopeId: "ws-1",
      enabled: true,
    });
    await waitFor(() => expect(onOpenMapping).toHaveBeenCalledWith(undefined));
  });

  it("reports a duplicate group without closing the form", async () => {
    mocks.getScim.mockResolvedValue({
      ...scimSettings,
      data: { ...scimSettings.data, enabled: true },
    });
    mocks.patchScim.mockRejectedValue(
      new IdentityAdminError(409, "x", "Duplicate group mapping", null),
    );
    const { onOpenMapping } = await renderPanel("new");
    fireEvent.change(await screen.findByLabelText("External group ID"), {
      target: { value: "group-1" },
    });
    fireEvent.click(await screen.findByRole("combobox", { name: "Workspace" }));
    fireEvent.click(await screen.findByRole("option", { name: "Operations" }));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Eligible role" }),
      ).not.toHaveAttribute("data-disabled"),
    );
    fireEvent.click(
      await screen.findByRole("combobox", { name: "Eligible role" }),
    );
    fireEvent.click(await screen.findByRole("option", { name: /Agent/u }));
    await enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Create mapping" }));
    await screen.findByText(/already exists for this connection/u);
    expect(onOpenMapping).not.toHaveBeenCalledWith(undefined);
  });

  it("edits only the changed mutable property of an existing mapping and cannot change its group id", async () => {
    mocks.patchScim.mockResolvedValue(scimSettings);
    await renderPanel("map-1");
    expect(screen.queryByLabelText("External group ID")).toBeNull();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Mapping enabled" }),
    );
    await enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(mocks.prove).toHaveBeenCalled());
    expect(mocks.prove.mock.calls[0]?.[0].request).toEqual({
      configVersion: 7,
      kind: "mapping_update",
      mappingId: "map-1",
      enabled: false,
    });
  });

  it("offers no delete and disables adding while SCIM is disabled", async () => {
    await renderPanel();
    expect(
      screen.queryByRole("button", { name: /delete|remove/iu }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add group mapping" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        /needs the Groups resource to be allowed and SCIM to be enabled/u,
      ),
    ).toBeInTheDocument();
  });

  it("explains a mapping id that no longer exists", async () => {
    await renderPanel("gone");
    expect(await screen.findByText("Mapping not found")).toBeInTheDocument();
  });
});
