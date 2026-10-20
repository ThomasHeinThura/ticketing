import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluate,
  MANDATORY_SECTIONS,
  saysNotApplicable,
} from "./check-pr-template.mjs";

const headings = [
  "What and why",
  "How it was checked",
  "Reviewed by",
  "Security",
  "Screens",
  "Not done",
];

function body(overrides = {}) {
  const values = {
    "What and why": "Fixes the portal sign-in route.",
    "How it was checked": "pnpm test, opened /sign-in on SIT.",
    "Reviewed by": "Independent Claude session, comment link.",
    Security: "n/a — no auth, permission or route change.",
    Screens: "n/a — no web change in this pull request.",
    "Not done": "Nothing.",
    ...overrides,
  };
  return headings.map((h) => `## ${h}\n\n${values[h]}\n`).join("\n");
}

test("a complete body passes", async () => {
  assert.deepEqual(
    await evaluate({
      body: body(),
      headings,
      paths: ["docs/x.md"],
      security: [],
    }),
    [],
  );
});

test("an empty body fails", async () => {
  assert.equal(
    (await evaluate({ body: "", headings, paths: [], security: [] })).length,
    1,
  );
});

test("a missing section fails", async () => {
  const text = body().replace(/## Not done[\s\S]*$/, "");
  const failures = await evaluate({
    body: text,
    headings,
    paths: [],
    security: [],
  });
  assert.match(failures.join("\n"), /Not done/);
});

test("n/a without a reason fails", async () => {
  const failures = await evaluate({
    body: body({ Security: "n/a" }),
    headings,
    paths: [],
    security: [],
  });
  assert.match(failures.join("\n"), /without a reason/);
});

test("review is never n/a", async () => {
  const failures = await evaluate({
    body: body({ "Reviewed by": "n/a — small docs change only" }),
    headings,
    paths: [],
    security: [],
  });
  assert.match(failures.join("\n"), /independent review/);
});

test("security cannot be n/a when security paths change", async () => {
  const failures = await evaluate({
    body: body(),
    headings,
    paths: ["apps/api/src/auth/x.ts"],
    security: ["apps/api/src/auth/x.ts"],
  });
  assert.match(failures.join("\n"), /security paths/);
});

test("screens cannot be n/a when apps/web changes", async () => {
  const failures = await evaluate({
    body: body(),
    headings,
    paths: ["apps/web/src/a.tsx"],
    security: [],
  });
  assert.match(failures.join("\n"), /apps\/web/);
});

test("disguised n/a forms are recognised", () => {
  for (const text of [
    "n/a — x",
    "- n/a — no change",
    "**N/A** — x",
    "Not applicable here",
    "None.",
    "> n/a",
  ]) {
    assert.ok(saysNotApplicable(text), text);
  }
  assert.ok(!saysNotApplicable("Narrow change to the auth guard."));
});

test("a list-item n/a still cannot dodge the security rule", async () => {
  const failures = await evaluate({
    body: body({ Security: "- N/A — no change" }),
    headings,
    paths: ["apps/api/src/auth/x.ts"],
    security: ["apps/api/src/auth/x.ts"],
  });
  assert.match(failures.join("\n"), /security paths/);
});

test("Reviewed by, Security and Screens are mandatory regardless of the template", () => {
  assert.deepEqual(MANDATORY_SECTIONS, ["Reviewed by", "Security", "Screens"]);
});
