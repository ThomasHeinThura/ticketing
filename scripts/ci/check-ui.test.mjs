/**
 * check:ui — unit tests for the pure Radix-import-scan and KNOWN-RADIX.md-table-parsing
 * functions, against fixture strings built inline here — never the real repo tree or the
 * real KNOWN-RADIX.md, so a future edit to either cannot make this suite pass or fail for
 * the wrong reason.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseKnownRadixTable, radixImportsIn } from "./check-ui.mjs";

function table(rows) {
  return [
    "# Known Radix references",
    "",
    "Some prose that mentions @radix-ui/react-slot without it being a table row.",
    "",
    "| File | Package | Reason |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

describe("check:ui — radixImportsIn", () => {
  it('finds a named-import `from "@radix-ui/react-slot"`', () => {
    const source = 'import { Slot } from "@radix-ui/react-slot";\n';
    assert.deepEqual(radixImportsIn(source), ["@radix-ui/react-slot"]);
  });

  it("finds the bare `radix-ui` umbrella package", () => {
    const source = 'import { Slot } from "radix-ui";\n';
    assert.deepEqual(radixImportsIn(source), ["radix-ui"]);
  });

  it("finds a dynamic import() and a require()", () => {
    const source = [
      'const x = await import("@radix-ui/react-dialog");',
      'const y = require("radix-ui");',
    ].join("\n");
    assert.deepEqual(radixImportsIn(source), [
      "@radix-ui/react-dialog",
      "radix-ui",
    ]);
  });

  it('finds a side-effect-only `import "radix-ui"` with no `from`', () => {
    const source = 'import "radix-ui";\n';
    assert.deepEqual(radixImportsIn(source), ["radix-ui"]);
  });

  it("does not double-count a named import with `from` (only the `from` branch matches)", () => {
    const source = 'import { Slot } from "@radix-ui/react-slot";\n';
    assert.deepEqual(radixImportsIn(source), ["@radix-ui/react-slot"]);
  });

  it('finds a re-export `export { Slot } from "@radix-ui/react-slot"`', () => {
    const source = 'export { Slot } from "@radix-ui/react-slot";\n';
    assert.deepEqual(radixImportsIn(source), ["@radix-ui/react-slot"]);
  });

  it("ignores an ordinary, unrelated import", () => {
    const source = 'import * as React from "react";\n';
    assert.deepEqual(radixImportsIn(source), []);
  });

  it("ignores a comment that merely mentions a Radix package name, since it is not import syntax", () => {
    const source = [
      "// Replaces @radix-ui/react-slot with a local implementation.",
      '/* also mentions "radix-ui" here */',
      'import * as React from "react";',
    ].join("\n");
    assert.deepEqual(radixImportsIn(source), []);
  });

  it("does not false-positive on a package whose name merely starts with the same letters", () => {
    const source = 'import { x } from "@radix-ui-extras/something";\n';
    // Not a real Radix scope — starts with "@radix-ui" but is a different package name
    // once you look past the prefix ("@radix-ui-extras", not "@radix-ui/...").
    assert.deepEqual(radixImportsIn(source), []);
  });

  it("finds more than one Radix import in the same file", () => {
    const source = [
      'import { Slot } from "@radix-ui/react-slot";',
      'import { Dialog } from "@radix-ui/react-dialog";',
    ].join("\n");
    assert.deepEqual(radixImportsIn(source), [
      "@radix-ui/react-slot",
      "@radix-ui/react-dialog",
    ]);
  });
});

describe("check:ui — parseKnownRadixTable — the correct shape", () => {
  it("a table with zero data rows parses to an empty array", () => {
    assert.deepEqual(parseKnownRadixTable(table([])), []);
  });

  it("a table with one well-formed data row parses it", () => {
    const rows = parseKnownRadixTable(
      table([
        "| apps/web/src/components/ui/example.tsx | @radix-ui/react-select | pending Base UI equivalent |",
      ]),
    );
    assert.deepEqual(rows, [
      {
        file: "apps/web/src/components/ui/example.tsx",
        pkg: "@radix-ui/react-select",
        reason: "pending Base UI equivalent",
      },
    ]);
  });

  it("multiple data rows all parse, in order", () => {
    const rows = parseKnownRadixTable(
      table([
        "| a.tsx | @radix-ui/react-select | r1 |",
        "| b.tsx | radix-ui | r2 |",
      ]),
    );
    assert.deepEqual(
      rows.map((r) => r.file),
      ["a.tsx", "b.tsx"],
    );
    assert.deepEqual(
      rows.map((r) => r.pkg),
      ["@radix-ui/react-select", "radix-ui"],
    );
  });
});

describe("check:ui — parseKnownRadixTable — malformed input is a hard failure", () => {
  it("throws when the document has no table at all", () => {
    assert.throws(
      () =>
        parseKnownRadixTable("# Known Radix references\n\nNo table here.\n"),
      /contains no GFM table/,
    );
  });

  it("throws when the header cells do not match the fixed column set", () => {
    const source = ["| File | Pkg | Why |", "| --- | --- | --- |", ""].join(
      "\n",
    );
    assert.throws(() => parseKnownRadixTable(source), /fixed/);
  });

  it("throws when the header has the wrong number of columns", () => {
    const source = ["| File | Package |", "| --- | --- |", ""].join("\n");
    assert.throws(() => parseKnownRadixTable(source), /fixed/);
  });

  it("throws when the second line is not a GFM separator row", () => {
    const source = [
      "| File | Package | Reason |",
      "| a.tsx | radix-ui | oops, no separator row |",
      "",
    ].join("\n");
    assert.throws(() => parseKnownRadixTable(source), /separator row/);
  });

  it("throws when a data row has the wrong number of cells", () => {
    const source = table(["| a.tsx | radix-ui |"]);
    assert.throws(() => parseKnownRadixTable(source), /cell\(s\)/);
  });

  it("throws when a data row has an empty File or Package cell", () => {
    const source = table(["|  | radix-ui | reason |"]);
    assert.throws(() => parseKnownRadixTable(source), /empty File or Package/);
  });
});
