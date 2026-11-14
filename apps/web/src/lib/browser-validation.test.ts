import { expect, it, vi } from "vitest";
import type { $ZodConfig } from "zod/v4/core";

it("validates standard-schema forms without dynamic evaluation on a cold import", async () => {
  vi.resetModules();
  const runtime = globalThis as typeof globalThis & {
    __zod_globalConfig?: $ZodConfig;
  };
  const previous = runtime.__zod_globalConfig;
  delete runtime.__zod_globalConfig;
  const evaluate = vi.spyOn(globalThis, "Function");
  try {
    await import("./browser-validation");
    const { z } = await import("zod");
    const { standardSchemaResolver } = await import(
      "@hookform/resolvers/standard-schema"
    );
    expect(z.config().jitless).toBe(true);
    const resolver = standardSchemaResolver(z.object({ email: z.email() }));
    const options = { fields: {}, shouldUseNativeValidation: false };
    expect(
      await resolver({ email: "person@example.test" }, undefined, options),
    ).toEqual({
      values: { email: "person@example.test" },
      errors: {},
    });
    const invalid = await resolver({ email: "invalid" }, undefined, options);
    expect(invalid.values).toEqual({});
    expect(invalid.errors.email?.message).toBeTruthy();
    expect(evaluate).not.toHaveBeenCalled();
  } finally {
    evaluate.mockRestore();
    if (previous === undefined) delete runtime.__zod_globalConfig;
    else runtime.__zod_globalConfig = previous;
    vi.resetModules();
  }
});
