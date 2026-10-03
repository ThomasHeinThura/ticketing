import assert from "node:assert/strict";
import test from "node:test";
import { findPortalModuleViolations } from "./check-bundle-purity.mjs";

test("G12 follows both static and dynamic chunks from the portal entry", () => {
  const graph = {
    version: 1,
    chunks: [
      {
        file: "assets/portal.js",
        isEntry: true,
        imports: ["assets/shared.js"],
        dynamicImports: ["assets/lazy.js"],
        modules: ["src/main.portal.tsx"],
      },
      {
        file: "assets/shared.js",
        imports: [],
        dynamicImports: [],
        modules: ["packages/ui/src/alert.tsx"],
      },
      {
        file: "assets/lazy.js",
        imports: ["assets/nested.js"],
        dynamicImports: [],
        modules: ["src/routes/portal/index.tsx"],
      },
      {
        file: "assets/nested.js",
        imports: [],
        dynamicImports: [],
        modules: ["src/routes/portal/__root.tsx"],
      },
      {
        file: "assets/unreachable.js",
        imports: [],
        dynamicImports: [],
        modules: ["src/routes/agent/work.tsx"],
      },
    ],
  };
  assert.deepEqual(findPortalModuleViolations(graph), []);
});

test("G12 RED PROBE: an agent route hidden in a transitive dynamic chunk fails", () => {
  const graph = {
    version: 1,
    chunks: [
      {
        file: "assets/portal.js",
        isEntry: true,
        imports: [],
        dynamicImports: ["assets/lazy.js"],
        modules: ["src/main.portal.tsx"],
      },
      {
        file: "assets/lazy.js",
        imports: ["assets/nested.js"],
        dynamicImports: [],
        modules: ["src/routes/portal/index.tsx"],
      },
      {
        file: "assets/nested.js",
        imports: [],
        dynamicImports: [],
        modules: ["src/routes/agent/projects/$key.tsx?tsr-split=component"],
      },
    ],
  };
  assert.deepEqual(findPortalModuleViolations(graph), [
    {
      file: "assets/nested.js",
      module: "src/routes/agent/projects/$key.tsx?tsr-split=component",
    },
  ]);
});

test("G12 fails closed when graph metadata omits a referenced dynamic chunk", () => {
  assert.throws(
    () =>
      findPortalModuleViolations({
        version: 1,
        chunks: [
          {
            file: "assets/portal.js",
            isEntry: true,
            imports: [],
            dynamicImports: ["assets/missing.js"],
            modules: [],
          },
        ],
      }),
    /references missing chunk/,
  );
});
