import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSchema = () => import("../../../apps/api/src/report/schema");
const loadCustom = () => import("../../../apps/api/src/report/custom");

// Real modules in both import orders: schema.ts must not depend on custom.ts (import cycle).
describe("report custom/schema import order", () => {
  beforeEach(() => vi.resetModules());

  it.each([
    ["custom first", true],
    ["schema first", false],
  ])(
    "evaluates and validates with real zod, %s",
    async (_name, customFirst) => {
      let custom: Awaited<ReturnType<typeof loadCustom>>;
      let schema: Awaited<ReturnType<typeof loadSchema>>;
      if (customFirst) {
        custom = await loadCustom();
        schema = await loadSchema();
      } else {
        schema = await loadSchema();
        custom = await loadCustom();
      }

      expect(custom.CUSTOM_CHART_TYPES).toBe(schema.CUSTOM_CHART_TYPES);
      expect(custom.CUSTOM_ENTITIES).toBe(schema.CUSTOM_ENTITIES);
      expect(custom.customQuerySchema).toBe(schema.customQuerySchema);
      expect(schema.customQuerySchema.parse({}).entity).toBe("work_item");
      expect(schema.customQuerySchema.safeParse({ entity: "x" }).success).toBe(
        false,
      );
      expect(
        schema.customPreviewBody.parse({ workspaceId: "w", query: {} })
          .chartType,
      ).toBe("bar");
      expect(
        schema.customPreviewBody.safeParse({
          workspaceId: "w",
          query: {},
          chartType: "pie",
        }).success,
      ).toBe(false);
      expect(
        custom.validateCustomQuery(schema.customQuerySchema.parse({})),
      ).toBeNull();
    },
  );
});
