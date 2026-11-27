import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createBundleAdapter,
  readBundle,
} from "../../../../apps/api/src/imports/adapters/bundle";
import { connection, readAll } from "./helpers";

// Loaded by variable so TypeScript does not need declarations for the .mjs script.
const scriptDir = resolve(__dirname, "../../../../scripts/import");
type Script = {
  main: (argv: string[], deps: Record<string, unknown>) => Promise<number>;
  fakePlane: (options: { token: string }) => { fetchImpl: unknown };
};
const load = async (name: string) =>
  (await import(/* @vite-ignore */ join(scriptDir, name))) as Script;

const dir = mkdtempSync(join(tmpdir(), "plane-e2e-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("plane-to-bundle output against the real schema and adapter", () => {
  it("writes files the domain schema accepts and the import.bundle adapter reads", async () => {
    const { main } = await load("plane-to-bundle.mjs");
    const { fakePlane } = await load("plane-fixture.mjs");
    const tokenFile = join(dir, "token");
    writeFileSync(tokenFile, "tok-secret-for-the-test\n");
    const out = join(dir, "out");
    await main(
      [
        "--base",
        "https://plane.lan",
        "--workspace",
        "acme",
        "--token-file",
        tokenFile,
        "--out",
        out,
      ],
      {
        fetchImpl: fakePlane({ token: "tok-secret-for-the-test" }).fetchImpl,
        sleep: async () => {},
        stdout: { write: () => true },
      },
    );
    // readBundle runs the domain schema and throws on any error in the file.
    for (const file of ["WEB", "OPS"])
      expect(() =>
        readBundle({
          bundleText: readFileSync(join(out, `${file}.ndjson`), "utf8"),
        }),
      ).not.toThrow();
    const bundleText = readFileSync(join(out, "WEB.ndjson"), "utf8");
    const adapter = createBundleAdapter();
    const records = await readAll(
      adapter,
      connection("import.bundle", { bundleText }),
    );
    expect(records.map((r) => r.sourceId)).toEqual(["w1", "w2", "w3"]);
    expect(records[0]?.comments).toHaveLength(2);
    expect(records[0]?.losses).toEqual(
      expect.arrayContaining([
        { code: "estimate_not_carried" },
        { code: "cycle_not_carried" },
        { code: "module_not_carried" },
      ]),
    );
    // Plane "triage" became backlog, reported by the converter, and the state facet carries it.
    const discovery = await adapter.discover(
      connection("import.bundle", { bundleText }),
    );
    expect(discovery.facets.map((f) => f.value)).toContain(
      "In Review (started)",
    );
  });
});
