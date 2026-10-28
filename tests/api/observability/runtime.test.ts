import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createMetricsListener: vi.fn() }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              version: 1,
              levels: {
                default: "info",
                modules: { http: "info" },
              },
            },
          ],
        }),
      }),
    }),
  },
  schema: {
    instanceSettingTable: {
      observabilityConfigVersion: "observability_config_version",
      observabilityLogLevels: "observability_log_levels",
      metricsTokenHash: "metrics_token_hash",
      id: "id",
    },
  },
}));
vi.mock("../../../apps/api/src/observability/metrics-listener.js", () => ({
  METRICS_LISTENER_MANIFEST: { port: 9464 },
  createMetricsListener: mocks.createMetricsListener,
}));

import {
  startObservabilityRuntime,
  stopObservabilityRuntime,
} from "../../../apps/api/src/instance/observability/runtime";

afterEach(async () => {
  await stopObservabilityRuntime();
  vi.clearAllMocks();
});

it("keeps the metrics listener off when a jobs role refreshes logging settings", async () => {
  await startObservabilityRuntime({ metricsListener: false });

  expect(mocks.createMetricsListener).not.toHaveBeenCalled();
});
