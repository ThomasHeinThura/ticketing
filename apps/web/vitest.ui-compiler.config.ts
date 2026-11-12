import babel from "@rolldown/plugin-babel";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../packages/ui/vitest.config";

// The application owns the production compiler dependencies and applies them to the UI recovery test.
const config = mergeConfig(
  base,
  defineConfig({
    plugins: [babel({ presets: [reactCompilerPreset()] })],
  }),
);
config.test = {
  ...config.test,
  include: ["src/components/toast-recovery.test.tsx"],
};
export default config;
