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

describe("scanFiles — a re-export of the client fails closed", () => {
  /**
   * These three exist because the re-export was a **demonstrated bypass of the whole gate**,
   * not a hypothesis. Before the refusal, a barrel of one line —
   * `export { authClient } from "./auth-client"` — plus a consumer importing from the barrel
   * and calling `authClient.organization.setActive(...)` produced the scanner's usual count
   * and **exit 0**. The call was neither counted nor refused.
   *
   * The star form is here for its own reason: it was still missed after the named form was
   * closed, because `export * from "./auth-client"` never spells `authClient` and the
   * per-file fast path skipped it unread. That was found by red-probing the new refusal
   * rather than by reading it, which is the only reason it is covered at all.
   *
   * The third test is the green control. Without it, "refuse every re-export" would satisfy
   * the first two and quietly fail the repository's many unrelated barrels.
   */
  it("a NAMED re-export of the auth-client module", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      'export { authClient } from "@/lib/auth-client";',
      "apps/web/src/lib/barrel.ts",
    );
    assert.equal(result.calls.length, 0);
    assert.equal(result.refusals.length, 1);
    assert.match(
      result.refusals[0].reason,
      /re-export of the auth-client module/,
    );
  });

  it("a STAR re-export, which never spells the binding at all", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      'export * from "@/lib/auth-client";',
      "apps/web/src/lib/barrel.ts",
    );
    assert.equal(result.calls.length, 0);
    assert.equal(result.refusals.length, 1);
    assert.match(
      result.refusals[0].reason,
      /re-export of the auth-client module/,
    );
  });

  it("but a re-export of an UNRELATED module is not refused", async () => {
    const dir = fixtureDir();
    write(dir, "apps/web/src/lib/cn.ts", "export const cn = () => {};");
    const result = await scanOne(
      dir,
      'export { cn } from "@/lib/cn";',
      "apps/web/src/lib/barrel.ts",
    );
    assert.equal(result.calls.length, 0);
    assert.equal(result.refusals.length, 0);
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

describe("scanFiles — S1: a `$`-leading/trailing alias is not invisible to \\b", () => {
  /**
   * `\b` is a WORD boundary, and `$` is not a word character — but that means `\b` does not
   * stop a run of identifier characters that CONTAINS a `$` either. An alias spelled with a
   * leading or trailing `$` therefore never matched the old `\b(?:...)\b` pattern in EITHER
   * direction, and the call was neither counted nor refused — exit 0, unchanged. Demonstrated
   * against the real checker, not theorised: both shapes below produced a clean pass before
   * the `(?<![\w$])...(?![\w$])` boundary replaced `\b`.
   */
  it("a root alias imported under a $-prefixed name", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient as $auth } from "@/lib/auth-client";',
        "await $auth.organization.setActive({ organizationId: 'x' });",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].family, "setActive");
  });

  it("an org-sub-client alias assigned to a $-prefixed name", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "const $org = authClient.organization;",
        "await $org.setActive({ organizationId: 'x' });",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].family, "setActive");
  });

  it("does NOT over-match a name that merely CONTAINS the tracked alias", async () => {
    const dir = fixtureDir();
    // `authClientFoo` shares the whole alias name as a prefix but is a different
    // identifier; the fix must still recognise the boundary at the far end (a `\w`
    // character immediately follows) even though `\b` is no longer what is doing the
    // recognising.
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "const authClientFoo = 1;",
        "export const x = authClientFoo;",
      ].join("\n"),
    );
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.refusals, []);
  });

  it("does NOT over-match a $-containing name that merely CONTAINS a $-alias", async () => {
    const dir = fixtureDir();
    // The tracked alias here is `$auth` (imported as such); `my$auth` contains it as a
    // suffix, preceded by an ordinary word character (`y`) rather than a boundary. The
    // negative lookbehind `(?<![\w$])` must reject this the same way `\b` correctly
    // rejected `authClientFoo` above.
    const result = await scanOne(
      dir,
      [
        'import { authClient as $auth } from "@/lib/auth-client";',
        "const my$auth = 1;",
        "export const x = my$auth;",
      ].join("\n"),
    );
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.refusals, []);
  });
});

describe("scanFiles — S2: a real call sharing a physical line is not shadowed", () => {
  /**
   * Suppression used to be tracked by PHYSICAL LINE: the whole line an import or an alias
   * -creation statement lived on was marked "already explained" and never re-examined. That
   * is too coarse whenever a real, distinct call shares that same line — the destructure
   * below and the live call after it are two separate statements that merely happen to sit
   * on one line, and the old line-based suppression dropped the second one along with the
   * first. Demonstrated against the real checker: this produced a clean exit 0 with the
   * `setActive` call neither counted nor refused, before consumption moved to exact
   * character ranges.
   */
  it("a live call after a same-line destructure of an unrelated member", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "const { useSession } = authClient; await authClient.organization.setActive({ organizationId: 'x' });",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].family, "setActive");
  });

  it("a live call after a same-line plain alias creation", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "const org = authClient.organization; await authClient.organization.setActive({ organizationId: 'x' });",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    // Two independent live calls on this one line: the alias-creation statement's own
    // `authClient.organization` mention stays correctly suppressed (it is not itself a
    // call — nothing follows it but `;`), and the explicit `authClient.organization.
    // setActive(...)` call is counted. Only the direct call is a `calls` entry.
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].family, "setActive");
  });
});

describe("scanFiles — S3: an out-of-root renamed re-export is never skipped unread", () => {
  /**
   * The fast path in `scanFiles` used to read a file fully only when it mentioned the
   * binding's export name, looked like it could re-export (`export` + `from`), or used a
   * dynamic import/`require`. A file that ONLY imports an out-of-root barrel's RENAMED
   * re-export, and calls the client exclusively through that local name, spells none of
   * those — no `authClient`, no `export`, no `import(`/`require(` — and was therefore
   * skipped and never read at all. Demonstrated against the real checker: this produced a
   * clean exit 0 with the call site neither counted nor refused, before the fast path also
   * treated any static `import` statement as its own reason to read the file.
   *
   * This needs its own fixture (not `scanOne`, which only ever writes the tsconfig, the
   * definition file, and the one file under scan): the bypass depends on a SECOND file, a
   * barrel living OUTSIDE `apps/web/src`, that `scanFiles` never scans directly but that
   * `reexportsDefinitionTransitively` reads on demand while resolving the in-root file's
   * import.
   */
  it("an in-root file consuming an out-of-root renamed re-export, spelling neither `authClient` nor `export`", async () => {
    const dir = fixtureDir();
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
    // The barrel: OUTSIDE apps/web/src, so scanFiles never scans it directly. It re-exports
    // the client under a renamed local binding — the point being that nothing about the
    // NAME `foo` gives away that it is the auth client.
    write(
      dir,
      "shared/auth-client-alias.ts",
      'export { authClient as foo } from "../apps/web/src/lib/auth-client";\n',
    );
    // The in-root file under scan: it imports only `foo` from the out-of-root barrel, and
    // otherwise never spells `authClient`, `export`, `import(`, or `require(` anywhere.
    const fileAbsolute = write(
      dir,
      "apps/web/src/case.ts",
      [
        'import { foo } from "../../../shared/auth-client-alias";',
        "",
        "async function activate(id: string) {",
        "  await foo.organization.setActive({ organizationId: id });",
        "}",
        'activate("x");',
      ].join("\n"),
    );

    const definition = findAuthClientDefinition([
      {
        absolute: authClientAbsolute,
        source: stripCodeComments(AUTH_CLIENT_SOURCE),
      },
    ]);
    const aliasRules = await loadPathAliases(
      path.join(dir, "apps/web/tsconfig.json"),
    );
    const fs = await import("node:fs/promises");
    const results = await scanFiles({
      definitionAbsolutePath: definition.file,
      exportName: definition.exportName,
      aliasRules,
      files: [fileAbsolute],
      readFile: (p) => fs.readFile(p, "utf8"),
    });

    // The file must not be silently skipped: it must now be refused (this scanner does not
    // trace a re-export chain rooted outside the scanned root), never a silent "0 calls, 0
    // refusals" that lets the call through unnoticed.
    const result = results[0] ?? { calls: [], refusals: [] };
    assert.equal(result.calls.length, 0);
    assert.equal(result.refusals.length, 1);
    assert.match(
      result.refusals[0].reason,
      /re-exports it through a chain of one or more further files/,
    );
  });
});

describe("scanFiles — S4: a string-borne fake `import` statement does not swallow a real call", () => {
  /**
   * `IMPORT_STATEMENT` runs over the STRING-INTACT pass (`code`), so an `import` keyword
   * spelled inside a string literal — a docs string, an error message, a code-sample
   * constant — can start a match. Its lazy `[^;]*?` clause then bridges across real code,
   * including a real, live `authClient.organization.*` call, to a LATER `from "…"`-shaped
   * string elsewhere in the same object literal (itself just string content too), and
   * `parseImportClause` parses the phantom span as a clean named import of the real
   * auth-client module. The whole span, real call included, used to be recorded as an
   * `importRanges` entry that suppressed the real call underneath it.
   *
   * Demonstrated against the real checker, not theorised: an ordinary file with a genuine
   * `import { authClient } from "@/lib/auth-client";` up top and a real, live call produced
   * a clean `[]` — the call neither counted nor refused — once two unrelated docs-style
   * string literals happened to sandwich it, before `findImportStatements` cross-checked
   * each match's `import` keyword against the STRING-STRIPPED pass at the same offset.
   */
  it("a real call sandwiched between a fake `import {...}` string and a fake `from '...'` string", async () => {
    const dir = fixtureDir();
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "",
        "const docs = {",
        '  note: "import { authClient }",',
        "  handler: () => authClient.organization.setActive({ organizationId: 'x' }),",
        "  source: \"adapted from '@/lib/auth-client'\",",
        "};",
        "export default docs;",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].family, "setActive");
  });

  it("a harmless docs string mentioning an unrelated import is not affected", async () => {
    const dir = fixtureDir();
    // Same shape, but the second string names a module that is NOT the auth client — the
    // phantom match (if it still formed) would resolve to nothing this scanner cares about,
    // same as any other import of an unrelated module. Confirms the fix is scoped to the
    // auth-client specifier, not a blanket suppression of every import-like string.
    const result = await scanOne(
      dir,
      [
        'import { authClient } from "@/lib/auth-client";',
        "",
        "const docs = {",
        '  note: "import { authClient }",',
        "  handler: () => authClient.organization.setActive({ organizationId: 'x' }),",
        "  source: \"adapted from '@/lib/some-unrelated-module'\",",
        "};",
        "export default docs;",
      ].join("\n"),
    );
    assert.deepEqual(result.refusals, []);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].family, "setActive");
  });
});
