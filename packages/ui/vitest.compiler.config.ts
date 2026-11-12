import { createRequire } from "node:module";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Use the app's installed compiler tooling, without adding a UI dependency.
const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { default: babel } = await import(
  require.resolve("@rolldown/plugin-babel")
);
const { reactCompilerPreset } = await import(
  require.resolve("@vitejs/plugin-react")
);
const config = mergeConfig(
  base,
  defineConfig({
    plugins: [babel({ presets: [reactCompilerPreset()] })],
    test: { include: ["src/components/toast-recovery.test.tsx"] },
  }),
);

config.test = {
  ...config.test,
  include: ["src/components/toast-recovery.test.tsx"],
};
export default config;
