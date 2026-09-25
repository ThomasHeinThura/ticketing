import assert from "node:assert/strict";
import test from "node:test";
import { findEnvReads, readFingerprints, viteBuiltIns } from "./env-reads.mjs";

test("findEnvReads attributes direct and literal-bracket environment names", () => {
  const reads = findEnvReads(
    [
      "const port = process.env.TASKDESK_PORT;",
      "const endpoint = process.env[\"S3_ENDPOINT\"] ?? process.env['S3_BUCKET'];",
    ].join("\n"),
  );

  assert.deepEqual(
    reads.map(({ object, kind, name, line }) => ({
      object,
      kind,
      name,
      line,
    })),
    [
      { object: "process.env", kind: "named", name: "TASKDESK_PORT", line: 1 },
      { object: "process.env", kind: "named", name: "S3_ENDPOINT", line: 2 },
      { object: "process.env", kind: "named", name: "S3_BUCKET", line: 2 },
    ],
  );
});

test("computed helper and lookup-table names remain unattributable", () => {
  const reads = findEnvReads(
    [
      "function env(name) { return process.env[name]; }",
      "const productKey = productKeys[tier.toUpperCase()];",
      "const product = process.env[productKey];",
    ].join("\n"),
  );

  assert.deepEqual(
    reads.map(({ kind, name, line }) => ({ kind, name, line })),
    [
      { kind: "computed", name: null, line: 1 },
      { kind: "computed", name: null, line: 3 },
    ],
  );
});

test("process.env aliases and typed parameter defaults are not silently ignored", () => {
  const reads = findEnvReads(
    [
      "const smtpEnv = process.env;",
      "function send(env: SmtpEnv = process.env) { return env.SMTP_HOST; }",
    ].join("\n"),
  );

  assert.deepEqual(
    reads.map(({ object, kind, name, line }) => ({
      object,
      kind,
      name,
      line,
    })),
    [
      { object: "process.env", kind: "alias", name: null, line: 1 },
      { object: "process.env", kind: "alias", name: null, line: 2 },
    ],
  );
});

test("destructured environment properties are attributed individually", () => {
  const reads = findEnvReads("const { SMTP_HOST, SMTP_PORT } = process.env;");

  assert.deepEqual(
    reads.map(({ kind, name }) => ({ kind, name })),
    [
      { kind: "named", name: "SMTP_HOST" },
      { kind: "named", name: "SMTP_PORT" },
    ],
  );
});

test("Vite built-ins stay separate from application configuration names", () => {
  const reads = findEnvReads(
    "const development = import.meta.env.DEV; const api = import.meta.env.VITE_API_URL;",
  );

  assert.deepEqual(
    reads.map(({ object, name }) => ({ object, name })),
    [
      { object: "import.meta.env", name: "DEV" },
      { object: "import.meta.env", name: "VITE_API_URL" },
    ],
  );
  assert.equal(viteBuiltIns.has("DEV"), true);
  assert.equal(viteBuiltIns.has("VITE_API_URL"), false);
});

test("unattributable read fingerprints preserve identity and occurrence", () => {
  const reads = findEnvReads(
    ["const value = process.env[key];", "const value = process.env[key];"].join(
      "\n",
    ),
  );

  assert.deepEqual(readFingerprints(reads), [
    "computed #1: const value = process.env[key];",
    "computed #2: const value = process.env[key];",
  ]);
});
