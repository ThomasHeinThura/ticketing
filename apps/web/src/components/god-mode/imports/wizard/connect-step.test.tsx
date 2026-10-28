import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { engineRun, i18nMock, renderWithQuery } from "./test-support";

const mocks = vi.hoisted(() => ({
  listSources: vi.fn(),
  createSource: vi.fn(),
  createRun: vi.fn(),
  projects: vi.fn(),
}));

vi.mock("react-i18next", () => i18nMock());
vi.mock("@/fetchers/god-mode/imports", async (original) => ({
  ...(await original<typeof import("@/fetchers/god-mode/imports")>()),
  listImportSources: (...args: unknown[]) => mocks.listSources(...args),
  createImportSource: (...args: unknown[]) => mocks.createSource(...args),
  createEngineImportRun: (...args: unknown[]) => mocks.createRun(...args),
}));
vi.mock("@/fetchers/project/get-projects", () => ({
  default: (...args: unknown[]) => mocks.projects(...args),
}));

import { ImportReasonError } from "@/fetchers/god-mode/imports";
import { ConnectStep } from "./connect-step";

const SECRET = "pat-super-secret-value";

beforeEach(() => {
  mocks.listSources.mockReset().mockResolvedValue([]);
  mocks.projects
    .mockReset()
    .mockResolvedValue([{ id: "project-1", name: "Support", slug: "SUP" }]);
  mocks.createSource.mockReset().mockResolvedValue({
    id: "source-1",
    workspaceId: "workspace-1",
    pluginId: "import.azure-devops",
    name: "Contoso ADO",
    config: {},
    hasCredential: true,
    readOnly: true,
    createdAt: "2026-10-26T09:00:00.000Z",
  });
  mocks.createRun
    .mockReset()
    .mockResolvedValue(engineRun({ phase: "created" }));
});
afterEach(cleanup);

function renderStep() {
  const onCreated = vi.fn();
  const onCancel = vi.fn();
  renderWithQuery(
    <ConnectStep
      workspaceId="workspace-1"
      onCreated={onCreated}
      onCancel={onCancel}
    />,
  );
  return { onCreated, onCancel };
}

async function fillAzureDevops() {
  fireEvent.click(screen.getByRole("radio", { name: /Azure DevOps/ }));
  fireEvent.change(await screen.findByLabelText("Connection name"), {
    target: { value: "Contoso ADO" },
  });
  fireEvent.change(screen.getByLabelText("Organisation"), {
    target: { value: "contoso" },
  });
  fireEvent.change(
    screen.getByLabelText("API token or personal access token"),
    {
      target: { value: SECRET },
    },
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Target project" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Support" }));
  fireEvent.change(screen.getByLabelText("Source reference"), {
    target: { value: "contoso-q4" },
  });
}

describe("ConnectStep", () => {
  it("sends the credential once under `credential`, never in config, and never shows it again", async () => {
    const { onCreated } = renderStep();
    await fillAzureDevops();
    const field = screen.getByLabelText(
      "API token or personal access token",
    ) as HTMLInputElement;
    expect(field.type).toBe("password");

    fireEvent.click(
      screen.getByRole("button", { name: "Connect and continue" }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());

    const [body, key] = mocks.createSource.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(body.credential).toBe(SECRET);
    expect(JSON.stringify(body.config)).not.toContain(SECRET);
    expect(body.config).toEqual({ organization: "contoso" });
    expect(typeof key).toBe("string");
    expect(mocks.createRun).toHaveBeenCalledWith(
      "source-1",
      { projectId: "project-1", sourceRef: "contoso-q4" },
      expect.any(String),
    );
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(field.value).toBe("");
  });

  it("shows the fixed reason when the source cannot be connected", async () => {
    mocks.createSource.mockRejectedValue(
      new ImportReasonError(
        502,
        "Import source could not be created",
        "auth_failed",
      ),
    );
    renderStep();
    await fillAzureDevops();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect and continue" }),
    );
    expect(
      await screen.findByText("The source refused the credential."),
    ).toBeTruthy();
    expect(screen.queryByText(SECRET)).toBeNull();
  });

  it("does not create the source twice when only the run request is retried", async () => {
    mocks.createRun
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(engineRun({ phase: "created" }));
    const { onCreated } = renderStep();
    await fillAzureDevops();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect and continue" }),
    );
    await screen.findByText("Could not connect");
    fireEvent.click(
      screen.getByRole("button", { name: "Connect and continue" }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mocks.createSource).toHaveBeenCalledTimes(1);
    expect(mocks.createRun).toHaveBeenCalledTimes(2);
    expect(mocks.createRun.mock.calls[0]?.[2]).toBe(
      mocks.createRun.mock.calls[1]?.[2],
    );
  });

  it("reads a CSV file into config.csvText and sends no credential for file sources", async () => {
    const { onCreated } = renderStep();
    fireEvent.click(screen.getByRole("radio", { name: /Generic CSV/ }));
    fireEvent.change(await screen.findByLabelText("Connection name"), {
      target: { value: "Tickets" },
    });
    expect(
      screen.queryByLabelText("API token or personal access token"),
    ).toBeNull();
    const file = new File(["external_id,title\n1,Hello"], "tickets.csv", {
      type: "text/csv",
    });
    fireEvent.change(screen.getByLabelText("CSV file"), {
      target: { files: [file] },
    });
    expect(await screen.findByText("Loaded tickets.csv.")).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("button", { name: "Target project" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Support" }));
    fireEvent.change(screen.getByLabelText("Source reference"), {
      target: { value: "tickets" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Connect and continue" }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const body = mocks.createSource.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(body.pluginId).toBe("import.csv");
    expect(body.config).toEqual({ csvText: "external_id,title\n1,Hello" });
    expect("credential" in body).toBe(false);
  });

  it("rejects a file larger than the adapters accept", async () => {
    renderStep();
    fireEvent.click(screen.getByRole("radio", { name: /Generic CSV/ }));
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.csv");
    fireEvent.change(await screen.findByLabelText("CSV file"), {
      target: { files: [big] },
    });
    expect(
      await screen.findByText(
        "The file could not be read or is larger than 5 MB.",
      ),
    ).toBeTruthy();
  });

  it("offers a saved connection for the chosen source and reuses it without a credential", async () => {
    mocks.listSources.mockResolvedValue([
      {
        id: "source-9",
        workspaceId: "workspace-1",
        pluginId: "import.plane",
        name: "Plane prod",
        config: {},
        hasCredential: true,
        readOnly: true,
        createdAt: "2026-10-26T09:00:00.000Z",
      },
    ]);
    const { onCreated } = renderStep();
    fireEvent.click(screen.getByRole("radio", { name: /Plane/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Saved connection" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Plane prod" }));
    expect(screen.getByText("Credential stored")).toBeTruthy();
    expect(
      screen.queryByLabelText("API token or personal access token"),
    ).toBeNull();
    fireEvent.click(
      await screen.findByRole("button", { name: "Target project" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Support" }));
    fireEvent.change(screen.getByLabelText("Source reference"), {
      target: { value: "plane-q4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Connect and continue" }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mocks.createSource).not.toHaveBeenCalled();
    expect(mocks.createRun.mock.calls[0]?.[0]).toBe("source-9");
  });
});
