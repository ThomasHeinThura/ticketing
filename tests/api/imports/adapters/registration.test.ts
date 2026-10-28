import { describe, expect, it } from "vitest";
import { ensureImportAdaptersRegistered } from "../../../../apps/api/src/imports/adapters";
import { registerPlaneAdapter } from "../../../../apps/api/src/imports/adapters/plane";
import {
  getImportAdapter,
  registerImportAdapter,
  registerMissingImportAdapters,
  unregisterImportAdapter,
} from "../../../../apps/api/src/imports/engine/adapter";
import { createFakeAdapter } from "../../../../apps/api/src/imports/engine/test-adapter";

const conn = (
  pluginId: string,
  config: Record<string, unknown>,
  credential = "secret-value",
) => ({ pluginId, config, credential, readOnly: true }) as never;

describe("startup registration", () => {
  it("registers every adapter once and resolves each plugin id", () => {
    ensureImportAdaptersRegistered();
    ensureImportAdaptersRegistered();
    for (const id of [
      "import.csv",
      "import.planner",
      "import.power-apps",
      "import.jira",
      "import.jsm",
      "import.azure-devops",
      "import.plane",
    ])
      expect(getImportAdapter(id)?.pluginId, id).toBe(id);
  });

  it("never replaces an adapter registered earlier", () => {
    const custom = () => createFakeAdapter("import.plane", 3);
    registerImportAdapter("import.plane", custom);
    registerMissingImportAdapters(() =>
      registerImportAdapter("import.plane", () =>
        createFakeAdapter("import.plane", 99),
      ),
    );
    expect(getImportAdapter("import.plane")?.chunkSize).toBe(3);
    unregisterImportAdapter("import.plane");
    registerPlaneAdapter();
  });
});

describe("attachment download credentials", () => {
  it("are derived from the connection for the source's own host only", () => {
    ensureImportAdaptersRegistered();
    const jira = getImportAdapter("import.jira")?.attachmentAuth?.(
      conn(
        "import.jira",
        {
          baseUrl: "https://acme.atlassian.net",
          projectKey: "ACME",
          email: "a@example.com",
        },
        "tok",
      ),
    );
    expect(jira?.hosts).toEqual(["acme.atlassian.net"]);
    expect(jira?.headers.authorization).toBe(
      `Basic ${Buffer.from("a@example.com:tok").toString("base64")}`,
    );
    const ado = getImportAdapter("import.azure-devops")?.attachmentAuth?.(
      conn("import.azure-devops", { organization: "contoso" }, "pat"),
    );
    expect(ado?.hosts).toEqual(["dev.azure.com"]);
    expect(ado?.headers.authorization).toBe(
      `Basic ${Buffer.from(":pat").toString("base64")}`,
    );
    const plane = getImportAdapter("import.plane")?.attachmentAuth?.(
      conn("import.plane", { workspace: "acme" }, "key"),
    );
    expect(plane?.hosts).toEqual(["api.plane.so"]);
    expect(plane?.headers).toEqual({ "x-api-key": "key" });
    // No credential, no auth; an export-mode Jira source has no host to send one to.
    expect(
      getImportAdapter("import.plane")?.attachmentAuth?.(
        conn("import.plane", { workspace: "acme" }, ""),
      ),
    ).toBeNull();
    expect(
      getImportAdapter("import.jira")?.attachmentAuth?.(
        conn("import.jira", { mode: "export", exportText: "{}" }),
      ),
    ).toBeNull();
  });
});
