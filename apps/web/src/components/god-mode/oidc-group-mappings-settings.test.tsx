import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chooseOption, renderWithQuery } from "@/test/identity-test-harness";
import { OidcGroupMappingsSettings } from "./oidc-group-mappings-settings";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), prove: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({
  apiFetch: (...args: unknown[]) => mocks.fetch(...args),
}));
vi.mock("react-i18next", async (importOriginal) => {
  const { translate } = await import("@/test/en-translation");
  return {
    ...(await importOriginal<typeof import("react-i18next")>()),
    useTranslation: (ns: string) => ({
      t: (key: string, opts?: Record<string, unknown>) =>
        translate(key.includes(":") ? key : `${ns}:${key}`, opts),
    }),
  };
});
vi.mock("@/fetchers/god-mode/identity-step-up", () => ({
  proveIdentityOperation: (...args: unknown[]) => mocks.prove(...args),
}));
vi.mock("@/fetchers/god-mode/instance-users", () => ({
  getCurrentFactorStatus: async () => ({
    enabled: true,
    availableMethods: ["totp"],
  }),
}));
const mapping = {
  id: "map-1",
  externalGroupId: "aabbccdd-1122-3344-5566-778899aabbcc",
  externalGroupNameSnapshot: "Support group",
  roleId: "role-2",
  scope: "workspace",
  scopeId: "ws-1",
  enabled: true,
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
};
let rows: (typeof mapping)[];
let failRead: boolean;
let conflict: boolean;
let version = 7;
let customer = false;
let readStatus = 200;
let writeStatus = 200;
let unavailableCustomer = false;
beforeEach(() => {
  vi.clearAllMocks();
  rows = [mapping];
  failRead = false;
  conflict = false;
  version = 7;
  customer = false;
  readStatus = 200;
  writeStatus = 200;
  unavailableCustomer = false;
  mocks.prove.mockResolvedValue("proof-token");
  mocks.fetch.mockImplementation(
    async (url: string, init: RequestInit = {}) => {
      if (init.method === "POST" || init.method === "PATCH")
        return new Response(
          JSON.stringify(
            conflict
              ? { title: "Version conflict", currentVersion: 8 }
              : writeStatus !== 200
                ? { title: "Rejected" }
                : { data: mapping, configVersion: 8 },
          ),
          { status: conflict ? 409 : writeStatus },
        );
      if (url.includes("mapping-options"))
        return new Response(
          JSON.stringify(
            customer
              ? {
                  kind: "customer",
                  target: unavailableCustomer
                    ? null
                    : { id: "org-1", name: "Customer org" },
                  role: { id: "customer", name: "Customer", rank: 1 },
                  nextCursor: null,
                }
              : url.includes("workspaceId")
                ? {
                    kind: "agent_roles",
                    data: [{ id: "role-2", name: "Agent", rank: 3 }],
                    nextCursor: null,
                  }
                : {
                    kind: "agent_targets",
                    data: [{ id: "ws-1", name: "Operations" }],
                    nextCursor: null,
                  },
          ),
        );
      return new Response(
        JSON.stringify(
          failRead || readStatus !== 200
            ? { title: "Unavailable" }
            : { data: rows, configVersion: version },
        ),
        { status: failRead ? 403 : readStatus },
      );
    },
  );
});
function renderPanel(openMapping?: string) {
  const close = vi.fn();
  renderWithQuery(
    <OidcGroupMappingsSettings
      connectionId="conn-1"
      openMapping={openMapping}
      onOpenMapping={close}
    />,
  );
  return close;
}
async function submit(label: string) {
  fireEvent.change(await screen.findByLabelText("Authenticator code"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(mocks.prove).toHaveBeenCalled());
}
function write() {
  return mocks.fetch.mock.calls.find(
    (call) => call[1]?.method === "POST" || call[1]?.method === "PATCH",
  )?.[1] as RequestInit;
}
describe("OIDC group mappings", () => {
  it("lists persisted mapping facts", async () => {
    renderPanel();
    expect(await screen.findByText("Support group")).toBeInTheDocument();
    expect(screen.getByText(/Workspace: ws-1/)).toHaveTextContent("role-2");
    expect(screen.getByText(/Workspace: ws-1/)).toHaveTextContent(
      mapping.updatedAt,
    );
  });
  it("shows loading while the mapping read is pending", () => {
    mocks.fetch.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByRole("status", { hidden: true })).toHaveAttribute(
      "aria-label",
      "Loading OIDC group mappings…",
    );
  });
  it("rejects a non-UUID group before requesting proof", async () => {
    renderPanel("new");
    fireEvent.change(await screen.findByLabelText("External group ID"), {
      target: { value: "group-name" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create mapping" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create mapping" }));
    expect(
      await screen.findByText("Enter a valid Entra group object UUID."),
    ).toBeInTheDocument();
    expect(mocks.prove).not.toHaveBeenCalled();
  });
  it("shows an empty list", async () => {
    rows = [];
    renderPanel();
    expect(
      await screen.findByRole("button", { name: "Add group mapping" }),
    ).toBeEnabled();
    expect(screen.queryByRole("list")).toBeNull();
  });
  it("reports read errors and offers retry", async () => {
    failRead = true;
    renderPanel();
    expect(
      await screen.findByText("OIDC group mappings could not be loaded."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
  it("creates with the same canonical request bound to the proof", async () => {
    renderPanel("new");
    fireEvent.change(await screen.findByLabelText("External group ID"), {
      target: { value: mapping.externalGroupId.toUpperCase() },
    });
    await chooseOption(
      await screen.findByRole("combobox", { name: "Workspace" }),
      "Operations",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Eligible role" }),
      ).not.toHaveAttribute("data-disabled"),
    );
    await chooseOption(
      await screen.findByRole("combobox", { name: "Eligible role" }),
      /Agent/,
    );
    await submit("Create mapping");
    await waitFor(() => expect(write()).toBeDefined());
    const body = JSON.parse(String(write().body));
    expect(body).toMatchObject({
      configVersion: 7,
      externalGroupId: mapping.externalGroupId,
      scope: "workspace",
      scopeId: "ws-1",
      roleId: "role-2",
      enabled: true,
    });
    expect(mocks.prove.mock.calls[0][0]).toEqual({
      operation: "oidc_group_mapping_create",
      connectionId: "conn-1",
      request: body,
    });
    expect(write().headers).toEqual({
      "content-type": "application/json",
      "x-taskdesk-step-up-token": "proof-token",
    });
  });
  it("updates with configVersion in JSON and no If-Match header", async () => {
    renderPanel("map-1");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Mapping enabled" }),
    );
    await submit("Save mapping");
    await waitFor(() => expect(write()).toBeDefined());
    expect(write().method).toBe("PATCH");
    expect(JSON.parse(String(write().body))).toEqual({
      configVersion: 7,
      enabled: false,
    });
    expect(write().headers).toEqual({
      "content-type": "application/json",
      "x-taskdesk-step-up-token": "proof-token",
    });
    expect(mocks.prove.mock.calls[0][0]).toMatchObject({
      operation: "oidc_group_mapping_update",
      mappingId: "map-1",
      request: JSON.parse(String(write().body)),
    });
  });
  it("keeps a stale draft open and requires an explicit reload after 409", async () => {
    conflict = true;
    const close = renderPanel("map-1");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Mapping enabled" }),
    );
    await submit("Save mapping");
    expect(
      await screen.findByRole("button", { name: "Reload latest settings" }),
    ).toBeEnabled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("8");
    expect(
      screen.getByRole("checkbox", { name: "Mapping enabled" }),
    ).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Authenticator code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(mocks.prove).toHaveBeenCalledTimes(2));
    expect(mocks.prove.mock.calls[1][0].request.configVersion).toBe(7);
    version = 8;
    fireEvent.click(
      screen.getByRole("button", { name: "Reload latest settings" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Reload latest settings" }),
      ).toBeNull(),
    );
    expect(close).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Mapping enabled" }),
      ).toBeChecked(),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Mapping enabled" }));
    await submit("Save mapping");
    await waitFor(() => expect(mocks.prove).toHaveBeenCalledTimes(3));
    expect(mocks.prove.mock.calls[2][0].request.configVersion).toBe(8);
  });
  it("does not spend proof for whitespace-only edits", async () => {
    renderPanel("map-1");
    fireEvent.change(await screen.findByLabelText("Display name (optional)"), {
      target: { value: " Support group " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    expect(mocks.prove).not.toHaveBeenCalled();
  });
  it("disables an existing customer mapping with an exact diff and no scopeId", async () => {
    customer = true;
    rows = [
      {
        ...mapping,
        scope: "organisation",
        scopeId: "org-1",
        roleId: "customer",
      },
    ];
    renderPanel("map-1");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Mapping enabled" }),
    );
    await submit("Save mapping");
    await waitFor(() => expect(write()).toBeDefined());
    const body = JSON.parse(String(write().body));
    expect(body).toEqual({ configVersion: 7, enabled: false });
    expect(body).not.toHaveProperty("scopeId");
    expect(screen.queryByRole("combobox", { name: "Workspace" })).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Eligible role" }),
    ).toBeNull();
  });
  it("creates a customer mapping without scopeId", async () => {
    customer = true;
    renderPanel("new");
    fireEvent.change(await screen.findByLabelText("External group ID"), {
      target: { value: mapping.externalGroupId },
    });
    await screen.findByText(/Customer org/);
    await submit("Create mapping");
    await waitFor(() => expect(write()).toBeDefined());
    const body = JSON.parse(String(write().body));
    expect(body).toMatchObject({ scope: "organisation", roleId: "customer" });
    expect(body).not.toHaveProperty("scopeId");
    expect(screen.queryByRole("combobox", { name: "Workspace" })).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Eligible role" }),
    ).toBeNull();
  });
  it("reports a missing mapping from URL state", async () => {
    renderPanel("missing");
    expect(await screen.findByRole("button", { name: "Close" })).toBeEnabled();
    expect(screen.queryByRole("form")).toBeNull();
  });
  it.each([
    [
      403,
      "You do not have instance administrator access, or this session cannot make the change.",
    ],
    [404, "This connection is no longer available."],
    [
      503,
      "The identity service is temporarily unavailable. Nothing was changed; try again.",
    ],
  ])("classifies read failure %s", async (status, message) => {
    readStatus = Number(status);
    renderPanel();
    expect(
      await screen.findByText(String(message), {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
  it.each([
    [
      409,
      "That value already exists for this connection. Nothing was changed.",
    ],
    [
      422,
      "The change was rejected as invalid, unchanged, or no longer eligible. Nothing was changed.",
    ],
  ])("classifies write failure %s", async (status, message) => {
    writeStatus = Number(status);
    renderPanel("map-1");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Mapping enabled" }),
    );
    await submit("Save mapping");
    expect(
      await screen.findByText(String(message), {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
  it("guards unavailable customer targets before proof", async () => {
    customer = true;
    unavailableCustomer = true;
    renderPanel("new");
    fireEvent.change(await screen.findByLabelText("External group ID"), {
      target: { value: mapping.externalGroupId },
    });
    await screen.findByText(
      "No eligible customer organisation and role are available for this connection.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create mapping" }));
    expect(mocks.prove).not.toHaveBeenCalled();
  });
  it("clears verification and failure when cancelling and switching editors", async () => {
    conflict = true;
    function Stateful() {
      const [open, setOpen] = useState<string | undefined>("map-1");
      return (
        <OidcGroupMappingsSettings
          connectionId="conn-1"
          openMapping={open}
          onOpenMapping={setOpen}
        />
      );
    }
    renderWithQuery(<Stateful />);
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Mapping enabled" }),
    );
    await submit("Save mapping");
    await screen.findByRole("button", { name: "Reload latest settings" });
    fireEvent.change(screen.getByLabelText("Authenticator code"), {
      target: { value: "654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add group mapping" }));
    expect(await screen.findByLabelText("Authenticator code")).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "Reload latest settings" }),
    ).toBeNull();
  });
});
