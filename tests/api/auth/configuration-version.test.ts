import { describe, expect, it } from "vitest";
import { authConfigurationVersion } from "../../../apps/api/src/auth/configuration-version";

describe("authConfigurationVersion", () => {
  it("detects a row change even when another row has a larger counter", () => {
    const connectionRows = [{ id: "connection-1", configVersion: 4 }];
    const before = authConfigurationVersion(
      [{ id: "plugin-1", configVersion: 1 }],
      connectionRows,
    );
    const after = authConfigurationVersion(
      [{ id: "plugin-1", configVersion: 2 }],
      connectionRows,
    );

    expect(after).not.toBe(before);
  });

  it("detects identity connection changes hidden by a plugin counter", () => {
    const pluginRows = [{ id: "plugin-1", configVersion: 7 }];
    const before = authConfigurationVersion(pluginRows, [
      { id: "connection-1", configVersion: 1 },
    ]);
    const after = authConfigurationVersion(pluginRows, [
      { id: "connection-1", configVersion: 2 },
    ]);

    expect(after).not.toBe(before);
  });

  it("detects a row change when independent tables share the same maximum", () => {
    const before = authConfigurationVersion(
      [{ id: "plugin", configVersion: 4 }],
      [{ id: "connection", configVersion: 4 }],
    );
    const after = authConfigurationVersion(
      [{ id: "plugin", configVersion: 3 }],
      [{ id: "connection", configVersion: 4 }],
    );

    expect(after).not.toBe(before);
  });

  it("is independent of row ordering", () => {
    const first = authConfigurationVersion(
      [
        { id: "plugin-b", configVersion: 2 },
        { id: "plugin-a", configVersion: 5 },
      ],
      [{ id: "connection", configVersion: 4 }],
    );
    const reordered = authConfigurationVersion(
      [
        { id: "plugin-a", configVersion: 5 },
        { id: "plugin-b", configVersion: 2 },
      ],
      [{ id: "connection", configVersion: 4 }],
    );

    expect(reordered).toBe(first);
  });

  it("detects row creation and removal", () => {
    const existing = [{ id: "plugin", configVersion: 2 }];
    const withAnother = [...existing, { id: "new-plugin", configVersion: 1 }];

    expect(authConfigurationVersion(withAnother, [])).not.toBe(
      authConfigurationVersion(existing, []),
    );
    expect(authConfigurationVersion([], [])).not.toBe(
      authConfigurationVersion(existing, []),
    );
  });

  it("keeps identical row IDs scoped to their source table", () => {
    const plugin = authConfigurationVersion(
      [{ id: "same-id", configVersion: 1 }],
      [],
    );
    const connection = authConfigurationVersion(
      [],
      [{ id: "same-id", configVersion: 1 }],
    );

    expect(plugin).not.toBe(connection);
  });
});
