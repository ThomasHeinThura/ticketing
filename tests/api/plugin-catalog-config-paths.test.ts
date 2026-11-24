import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

vi.mock("../../apps/api/src/database", () => ({ default: {} }));
vi.mock("../../apps/api/src/notification-provider/service", () => ({
  getEmailProvider: vi.fn(),
}));
vi.mock("../../apps/api/src/storage", () => ({
  getStorageBackendStatus: vi.fn(),
}));
vi.mock("../../apps/api/src/storage/s3-draft-repository", () => ({
  readS3Draft: vi.fn(),
}));

// GM-5 (narrowed, #913): the catalog is fixed, and every entry must link to a real settings screen.
it("every supported plugin points at a registered God Mode screen", async () => {
  const { projectSupportedPlugins } = await import(
    "../../apps/api/src/instance/plugins/catalog"
  );
  const plugins = projectSupportedPlugins({
    id: null,
    version: 0,
    source: "unconfigured",
    enabled: false,
    config: null,
    passwordConfigured: false,
  } as never);
  const routes = readFileSync(
    new URL("../../apps/web/src/lib/routes.ts", import.meta.url),
    "utf8",
  );

  expect(plugins.map((plugin) => plugin.id)).toEqual([
    "notify.email",
    "storage.s3",
    "identity.sso",
    "observability.telemetry",
  ]);
  for (const plugin of plugins) {
    expect(plugin.configPath).toMatch(/^\/god-mode\/[a-z-]+$/);
    expect(routes).toContain(`path: "${plugin.configPath}" as const`);
  }
});
