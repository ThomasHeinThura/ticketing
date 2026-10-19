import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityAdminError } from "@/fetchers/god-mode/identity-admin-error";
import { renderWithQuery, staffConnection } from "@/test/identity-test-harness";
import { IdentityConnectionEditor } from "./identity-connection-editor";

const mocks = vi.hoisted(() => ({
  prove: vi.fn(),
  configure: vi.fn(),
  create: vi.fn(),
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
  getCurrentFactorStatus: async () => ({ enabled: false }),
}));
vi.mock("@/fetchers/god-mode/identity-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/god-mode/identity-connections")
  >()),
  configureIdentityConnection: (...args: unknown[]) => mocks.configure(...args),
  createIdentityConnection: (...args: unknown[]) => mocks.create(...args),
}));

beforeEach(() => {
  mocks.prove.mockResolvedValue("proof-token");
  mocks.configure.mockResolvedValue({ ...staffConnection, configVersion: 8 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function enterPassword(value = "placeholder-password") {
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value },
  });
}

function renderEditor(onReload = vi.fn()) {
  renderWithQuery(
    <IdentityConnectionEditor
      connection={staffConnection}
      onReload={onReload}
    />,
  );
  return onReload;
}

describe("IdentityConnectionEditor (edit)", () => {
  it("binds the exact changed fields and version to the proof and the write, then clears the secret", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Connection name"), {
      target: { value: "Renamed" },
    });
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Identity connection saved");
    expect(mocks.prove).toHaveBeenCalledWith(
      {
        operation: "identity_connection_configure",
        connectionId: "conn-1",
        request: { configVersion: 7, displayName: "Renamed" },
      },
      { method: "password", secret: "placeholder-password" },
    );
    expect(mocks.configure.mock.calls[0]?.[0]).toEqual({
      id: "conn-1",
      body: { configVersion: 7, displayName: "Renamed" },
      token: "proof-token",
    });
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByText(/now at version 8/u)).toBeInTheDocument();
  });

  it("does nothing, and spends no proof, when nothing changed", async () => {
    renderEditor();
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Nothing changed, so nothing was saved.");
    expect(mocks.prove).not.toHaveBeenCalled();
  });

  it("requires the verification factor before any request", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Connection name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(
      "Enter the selected verification factor to confirm this change.",
    );
    expect(mocks.prove).not.toHaveBeenCalled();
    expect(mocks.configure).not.toHaveBeenCalled();
  });

  it("keeps the draft and offers a reload on a stale version (409)", async () => {
    mocks.configure.mockRejectedValue(
      new IdentityAdminError(409, "x", "version_conflict", 9),
    );
    const onReload = renderEditor();
    fireEvent.change(screen.getByLabelText("Connection name"), {
      target: { value: "My edit" },
    });
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/now at version 9/u);
    expect(screen.getByLabelText("Connection name")).toHaveValue("My edit");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    fireEvent.click(
      screen.getByRole("button", { name: "Reload latest settings" }),
    );
    expect(onReload).toHaveBeenCalledOnce();
    // Reload discards the stale draft; the refetched snapshot is then adopted.
    expect(screen.getByLabelText("Connection name")).toHaveValue("Staff Entra");
    expect(screen.queryByText(/now at version 9/u)).toBeNull();
  });

  it("reports unavailable or expired fresh verification without writing", async () => {
    mocks.prove.mockRejectedValue(
      new IdentityAdminError(403, "x", "step_up_unavailable", null),
    );
    renderEditor();
    fireEvent.change(screen.getByLabelText("Connection name"), {
      target: { value: "Renamed" },
    });
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Fresh verification was unavailable/u);
    expect(mocks.configure).not.toHaveBeenCalled();
  });

  it("rejects the write when the API refuses the token after proof (403 step-up)", async () => {
    mocks.configure.mockRejectedValue(
      new IdentityAdminError(403, "x", "step_up_unavailable", null),
    );
    renderEditor();
    fireEvent.change(screen.getByLabelText("Connection name"), {
      target: { value: "Renamed" },
    });
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Fresh verification was unavailable/u);
    expect(screen.getByLabelText("Connection name")).toHaveValue("Renamed");
  });

  it("shows API 5xx failures truthfully and keeps the draft", async () => {
    mocks.configure.mockRejectedValue(
      new IdentityAdminError(503, "x", "", null),
    );
    renderEditor();
    fireEvent.change(screen.getByLabelText("Connection name"), {
      target: { value: "Renamed" },
    });
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/temporarily unavailable/u);
    expect(screen.getByLabelText("Connection name")).toHaveValue("Renamed");
  });

  it("sends a replacement secret only when typed and never displays the stored one", async () => {
    renderEditor();
    expect(screen.queryByDisplayValue("not-a-real-secret")).toBeNull();
    fireEvent.change(
      screen.getByLabelText("Replace client secret (optional)"),
      {
        target: { value: "replacement-placeholder" },
      },
    );
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.configure).toHaveBeenCalled());
    expect(mocks.configure.mock.calls[0]?.[0].body).toEqual({
      configVersion: 7,
      clientSecret: "replacement-placeholder",
    });
    await screen.findByText("Identity connection saved");
    expect(
      screen.getByLabelText("Replace client secret (optional)"),
    ).toHaveValue("");
  });

  it("offers the claim-mapping repair only for a malformed stored map", async () => {
    cleanup();
    renderWithQuery(
      <IdentityConnectionEditor
        connection={{
          ...staffConnection,
          claimMapping: null,
          claimMappingState: "invalid",
        }}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Save the default profile claim mapping",
      }),
    );
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.configure).toHaveBeenCalled());
    expect(mocks.configure.mock.calls[0]?.[0].body).toEqual({
      configVersion: 7,
      claimMapping: { version: 1, displayName: "name" },
    });
  });

  it("does not offer immutable fields for editing", () => {
    renderEditor();
    expect(screen.getByLabelText("Entra tenant ID")).toBeDisabled();
    expect(screen.queryByLabelText(/organisation/iu)).toBeNull();
  });
});

describe("IdentityConnectionEditor (create)", () => {
  it("creates a disabled staff connection bound to the complete body and reports the new id", async () => {
    mocks.create.mockResolvedValue({ ...staffConnection, id: "new-id" });
    const onCreated = vi.fn();
    renderWithQuery(
      <IdentityConnectionEditor
        connection={null}
        onCreated={onCreated}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Connection name"), {
      target: { value: "Staff" },
    });
    fireEvent.change(screen.getByLabelText("Entra tenant ID"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Application (client) ID"), {
      target: { value: "22222222-2222-4222-8222-222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Client secret"), {
      target: { value: "not-a-real-secret" },
    });
    fireEvent.change(screen.getByLabelText("Required Entra app role"), {
      target: { value: "TaskDesk.User" },
    });
    fireEvent.change(screen.getByLabelText("Maximum role rank"), {
      target: { value: "10" },
    });
    enterPassword();
    fireEvent.click(
      screen.getByRole("button", { name: "Create disabled connection" }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-id"));
    const binding = mocks.prove.mock.calls[0]?.[0];
    expect(binding.operation).toBe("identity_connection_create");
    expect(binding.request).toMatchObject({
      portalScope: "agent",
      organisationId: null,
    });
    expect(mocks.create.mock.calls[0]?.[0].body).toEqual(binding.request);
    expect(
      screen.queryByRole("checkbox", { name: "Connection enabled" }),
    ).toBeNull();
  });

  it("shows field errors and sends nothing for an invalid form", async () => {
    renderWithQuery(
      <IdentityConnectionEditor connection={null} onReload={vi.fn()} />,
    );
    enterPassword();
    fireEvent.click(
      screen.getByRole("button", { name: "Create disabled connection" }),
    );
    await screen.findByText("Enter the tenant ID as a UUID.");
    expect(mocks.prove).not.toHaveBeenCalled();
  });

  it("forgets a typed client secret from the input and the mutation cache once the write settles, on success", async () => {
    const SECRET = "typed-secret-placeholder";
    const { client } = renderWithQuery(
      <IdentityConnectionEditor
        connection={staffConnection}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByLabelText("Replace client secret (optional)"),
      {
        target: { value: SECRET },
      },
    );
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Identity connection saved");
    expect(
      screen.getByLabelText("Replace client secret (optional)"),
    ).toHaveValue("");
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((mutation) => mutation.state),
      ),
    ).not.toContain(SECRET);
  });

  it("forgets a typed client secret on failure too, and the user must re-enter it", async () => {
    const SECRET = "typed-secret-placeholder";
    mocks.configure.mockRejectedValue(
      new IdentityAdminError(503, "x", "", null),
    );
    const { client } = renderWithQuery(
      <IdentityConnectionEditor
        connection={staffConnection}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByLabelText("Replace client secret (optional)"),
      {
        target: { value: SECRET },
      },
    );
    enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/temporarily unavailable/u);
    expect(
      screen.getByLabelText("Replace client secret (optional)"),
    ).toHaveValue("");
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((mutation) => mutation.state),
      ),
    ).not.toContain(SECRET);
  });

  it("forgets the client secret after create settles", async () => {
    const SECRET = "typed-secret-placeholder";
    mocks.create.mockResolvedValue({ ...staffConnection, id: "new-id" });
    const { client } = renderWithQuery(
      <IdentityConnectionEditor
        connection={null}
        onCreated={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Connection name"), {
      target: { value: "Staff" },
    });
    fireEvent.change(screen.getByLabelText("Entra tenant ID"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Application (client) ID"), {
      target: { value: "22222222-2222-4222-8222-222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Client secret"), {
      target: { value: SECRET },
    });
    fireEvent.change(screen.getByLabelText("Required Entra app role"), {
      target: { value: "TaskDesk.User" },
    });
    fireEvent.change(screen.getByLabelText("Maximum role rank"), {
      target: { value: "10" },
    });
    enterPassword();
    fireEvent.click(
      screen.getByRole("button", { name: "Create disabled connection" }),
    );
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByLabelText("Client secret")).toHaveValue(""),
    );
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((mutation) => mutation.state),
      ),
    ).not.toContain(SECRET);
  });
});
