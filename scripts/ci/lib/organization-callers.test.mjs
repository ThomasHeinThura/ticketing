/**
 * Unit tests for lib/organization-callers.mjs's classification grammar. The end-to-end
 * behaviour (baseline ratchet, merge-base growth) is covered by
 * `probes/organization-caller-growth.test.mjs`; this file is the classifier in isolation —
 * every shape its header comment claims to recognise or refuse, run against a small
 * synthetic file tree rather than the real repository, so it stays fast and self-contained.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  findAuthClientDefinition,
  loadPathAliases,
  OrganizationCallerScanUnavailableError,
  scanFiles,
} from "./organization-callers.mjs";
import { stripCodeComments } from "./strip-code-comments.mjs";

const dirs = [];
function fixtureDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "org-callers-lib-"));
  dirs.push(dir);
  return dir;
}
after(() => {
  while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

function write(dir, relative, contents) {
  const absolute = path.join(dir, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  return absolute;
}

const AUTH_CLIENT_SOURCE = [
  "export const authClient = createAuthClient({ plugins: [] });",
  "",
].join("\n");

async function scanOne(dir, fileSource, fileRelPath = "apps/web/src/case.ts") {
  write(
    dir,
    "apps/web/tsconfig.json",
    JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
  );
  const authClientAbsolute = write(
    dir,
    "apps/web/src/lib/auth-client.ts",
    AUTH_CLIENT_SOURCE,
  );
  const fileAbsolute = write(dir, fileRelPath, fileSource);

  const fs = await import("node:fs/promises");
  const definition = findAuthClientDefinition([
    {
      absolute: authClientAbsolute,
      source: stripCodeComments(AUTH_CLIENT_SOURCE),
    },
  ]);
  const aliasRules = await loadPathAliases(
    path.join(dir, "apps/web/tsconfig.json"),
  );
  const results = await scanFiles({
    definitionAbsolutePath: definition.file,
    exportName: definition.exportName,
    aliasRules,
    files: [fileAbsolute],
    readFile: (p) => fs.readFile(p, "utf8"),
  });
  return results[0] ?? { calls: [], refusals: [] };
}

describe("findAuthClientDefinition", () => {
  it("fails closed when nothing defines the client", () => {
    assert.throws(
      () => findAuthClientDefinition([]),
      OrganizationCallerScanUnavailableError,
    );
  });

  it("fails closed when more than one file defines the client", () => {
    assert.throws(
      () =>
        findAuthClientDefinition([
          {
            absolute: "/a.ts",
            source: "export const authClient = createAuthClient({});",
          },
          {
            absolute: "/b.ts",
            source: "export const other = createAuthClient({});",
          },
        ]),
      OrganizationCallerScanUnavailableError,
    );
  });
});

describe("scanFiles — recognised call shapes", () => {
  it("a plain call", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "await authClient.organization.setActive({ organizationId: 'x' });",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].family, "setActive");
  });

  it("optional chaining at every link", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "await authClient?.organization?.setActive?.({ organizationId: 'x' });",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].family, "setActive");
  });

  it("generic type arguments on the call", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "await authClient.organization.setActive<{ organizationId: string }>({ organizationId: 'x' });",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].family, "setActive");
  });

  it("a plain local alias — const org = authClient.organization", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "const org = authClient.organization;",
        "await org.setActive({ organizationId: 'x' });",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].family, "setActive");
  });

  it("a destructured alias — const { organization } = authClient", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "const { organization } = authClient;",
        "await organization.setActive({ organizationId: 'x' });",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    assert.equal(result.calls.length, 1);
  });

  it("a renamed destructured alias — const { organization: org } = authClient", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "const { organization: org } = authClient;",
        "await org.setActive({ organizationId: 'x' });",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    assert.equal(result.calls.length, 1);
  });
});

describe("scanFiles — must NOT be flagged", () => {
  it("a comment naming the method", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "// native replacement for authClient.organization.setActive().",
        "export const x = 1;",
      ].join("\n"),
    );
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.refusals, []);
  });

  it("a destructure of an unrelated member", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "const { useSession } = authClient;",
        "export const x = useSession;",
      ].join("\n"),
    );
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.refusals, []);
  });

  it("an object-literal key in a mock factory", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'vi.mock("@/lib/auth-client", () => ({',
        "  authClient: { organization: { setActive: vi.fn() } },",
        "}));",
      ].join("\n"),
    );
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.refusals, []);
  });

  it("a type-only import used only in a type position", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import type { authClient } from "@/lib/auth-client";',
        "export type X = ReturnType<typeof authClient.organization.getFullOrganization>;",
      ].join("\n"),
    );
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.refusals, []);
  });

  it("an unrelated method on the client", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "const { data } = authClient.useSession();",
      ].join("\n"),
    );
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.refusals, []);
  });
});

describe("scanFiles — fails closed", () => {
  it("computed member access on the client", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        'await authClient["organization"].setActive({});',
      ].join("\n"),
    );
    assert.equal(result.calls.length, 0);
    assert.equal(result.refusals.length, 1);
    assert.match(result.refusals[0].reason, /computed member access/);
  });

  it("computed member access on the method", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        'await authClient.organization["setActive"]({});',
      ].join("\n"),
    );
    assert.equal(result.calls.length, 0);
    assert.equal(result.refusals.length, 1);
    assert.match(result.refusals[0].reason, /computed member access/);
  });

  it("a method referenced without being called", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "const fn = authClient.organization.setActive;",
      ].join("\n"),
    );
    assert.equal(result.calls.length, 0);
    assert.equal(result.refusals.length, 1);
    assert.match(result.refusals[0].reason, /referenced without being called/);
  });

  it("the whole client passed bare to a function", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "function wrap(x: unknown) { return x; }",
        "export const x = wrap(authClient);",
      ].join("\n"),
    );
    assert.equal(result.calls.length, 0);
    assert.equal(result.refusals.length, 1);
    assert.match(result.refusals[0].reason, /referenced bare/);
  });

  it("a namespace import of the auth-client module", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import * as AuthClientModule from "@/lib/auth-client";',
        "await AuthClientModule.authClient.organization.setActive({});",
      ].join("\n"),
    );
    assert.equal(result.calls.length, 0);
    assert.equal(result.refusals.length, 1);
    assert.match(result.refusals[0].reason, /namespace import/);
  });
});
