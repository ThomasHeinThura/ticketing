import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildSummary,
  classifyDenial,
  isApiDenial,
  parseCli,
  parseRoutes,
  redactText,
  redactUrl,
  resolveRoute,
  rowsOf,
  runQueue,
  slugify,
  valuesFor,
} from "./screen-sweep.mjs";

test("parses the current inventory with portal host-root routes", async () => {
  const routes = parseRoutes(
    await readFile(new URL("../../docs/screens.md", import.meta.url), "utf8"),
  );
  assert.ok(
    routes.some(
      (row) =>
        row.route === "/agent/projects/{key}/work?layout=board" &&
        row.host === "agent",
    ),
  );
  assert.ok(
    routes.some(
      (row) => row.route === "/projects/{key}" && row.host === "portal",
    ),
  );
  assert.ok(!routes.some((row) => row.route === "?item={key}"));
});

test("resolves each required parameter and encodes values", () => {
  assert.equal(
    resolveRoute("/projects/{key}?ref=$ref", { key: "A/B", ref: "one two" }),
    "/projects/A%2FB?ref=one%20two",
  );
  assert.equal(resolveRoute("/projects/{key}/{id}", { key: "P" }), null);
});

test("{id} and {key} are filled per route, never from another resource", () => {
  const found = { key: "PRJ", workItemKey: "PRJ-1", team: "t1", article: "a1" };
  assert.equal(
    resolveRoute(
      "/dashboard/settings/workspace/teams/{id}",
      valuesFor("/dashboard/settings/workspace/teams/{id}", found),
    ),
    "/dashboard/settings/workspace/teams/t1",
  );
  assert.equal(
    resolveRoute("/agent/kb/{id}", valuesFor("/agent/kb/{id}", found)),
    "/agent/kb/a1",
  );
  assert.equal(
    resolveRoute(
      "/agent/work-items/{key}",
      valuesFor("/agent/work-items/{key}", found),
    ),
    "/agent/work-items/PRJ-1",
  );
  assert.equal(
    resolveRoute(
      "/dashboard/settings/workspace/roles/{id}",
      valuesFor("/dashboard/settings/workspace/roles/{id}", found),
    ),
    null,
  );
});

test("masks secret-named query parameters and drops credentials and fragment", () => {
  assert.equal(
    redactUrl(
      "https://user:password@example.invalid/p?layout=board&token=abc&Access_Token=d&code=1&x_key=2&sig=3#secret",
    ),
    "https://example.invalid/p?layout=board&token=REDACTED&Access_Token=REDACTED&code=REDACTED&x_key=REDACTED&sig=3",
  );
  assert.equal(redactUrl("not a URL"), "[invalid URL]");
  assert.equal(
    redactText("fetch https://a.invalid/x?secret=1 failed"),
    "fetch https://a.invalid/x?secret=REDACTED failed",
  );
});

test("slugifies route templates", () => {
  assert.equal(
    slugify("/agent/projects/{key}/work?layout=board"),
    "agent-projects-key-work-layout-board",
  );
  assert.equal(slugify("/"), "root");
});

test("classifies denials separately from failures", () => {
  const base = {
    requestedUrl: "https://h/agent/x",
    finalUrl: "https://h/agent/x",
    documentStatus: 200,
  };
  assert.equal(classifyDenial(base).denied, false);
  assert.equal(
    classifyDenial({ ...base, finalUrl: "https://h/auth/sign-in?next=x" })
      .reason,
    "redirected to sign-in",
  );
  assert.equal(
    classifyDenial({
      ...base,
      requestedUrl: "https://h/auth/sign-in",
      finalUrl: "https://h/auth/sign-in",
    }).denied,
    false,
  );
  assert.equal(classifyDenial({ ...base, documentStatus: 403 }).denied, true);
  assert.equal(
    classifyDenial({ ...base, apiStatuses: [200, 404] }).reason,
    "api 404",
  );
  assert.equal(classifyDenial({ ...base, apiStatuses: [500] }).denied, false);
  assert.equal(
    classifyDenial({ ...base, mainText: "Page not found" }).denied,
    true,
  );
  assert.equal(
    classifyDenial({ ...base, mainText: `not found ${"x".repeat(700)}` })
      .denied,
    false,
  );
});

test("validates CLI options", () => {
  const argv = [
    "--agent-origin",
    "https://a.localhost",
    "--portal-origin",
    "https://p.localhost",
    "--accounts",
    "a.json",
    "--out",
    "/tmp/o",
  ];
  const cli = parseCli([
    ...argv,
    "--widths",
    "390",
    "--themes",
    "dark",
    "--roles",
    "owner,admin",
  ]);
  assert.deepEqual(
    [cli.widths, cli.themes, cli.roles, cli.concurrency],
    [[390], ["dark"], ["owner", "admin"], 3],
  );
  assert.throws(() => parseCli(argv.slice(2)), /--agent-origin/);
  assert.throws(() => parseCli([...argv, "--themes", "blue"]), /themes/);
  assert.throws(() => parseCli([...argv, "--concurrency", "0"]), /concurrency/);
});

test("rowsOf finds the list in common response shapes", () => {
  assert.deepEqual(rowsOf([1]), [1]);
  assert.deepEqual(rowsOf({ meta: {}, data: [2] }), [2]);
  assert.deepEqual(rowsOf(null), []);
});

test("runQueue never exceeds the concurrency bound", async () => {
  let active = 0;
  let peak = 0;
  await runQueue([1, 2, 3, 4, 5, 6], 2, async () => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
  });
  assert.equal(peak, 2);
});

test("summary counts issues and builds the denial matrix", () => {
  const cells = [
    {
      role: "owner",
      route: "/a",
      width: 390,
      theme: "dark",
      denied: false,
      overflow: true,
      consoleErrors: [],
      failedRequests: [],
    },
    { role: "viewer", route: "/a", width: 390, theme: "dark", denied: true },
    { role: "viewer", route: "/b", skipped: "no reachable instance" },
  ];
  const md = buildSummary({ axe: false }, cells);
  assert.match(md, /\| overflow \| 1 \|/);
  assert.match(md, /\| denied \| 1 \|/);
  assert.match(md, /\| \/a \| ok \| D \|/);
  assert.match(md, /Axe: skipped/);
});

test("a refused History read is not a page denial", () => {
  const h = "https://h/api/audit?entity_type=workspace&entity_id=w1";
  assert.equal(isApiDenial(h, 403), false);
  assert.equal(isApiDenial("https://h/api/workspace/w1", 403), true);
  assert.equal(isApiDenial("https://h/api/audit/instance", 403), true);
});
