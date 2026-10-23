import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluate,
  MANDATORY_SECTIONS,
  phaseSubmission,
} from "./check-pr-template.mjs";

const body =
  "## What and why\n\nVisible integrated result.\n\n## How it was checked\n\nLocal tests passed; portal journey remains unverified.\n";
test("ordinary descriptions require only result and actual validation, not another reviewer", async () => {
  assert.deepEqual(MANDATORY_SECTIONS, ["What and why", "How it was checked"]);
  assert.deepEqual(await evaluate({ body }), []);
  assert.equal(phaseSubmission(body), null);
});
test("an empty description fails", async () => {
  assert.equal((await evaluate({ body: "" })).length, 1);
});
test("a missing validation section fails", async () => {
  assert.match(
    (await evaluate({ body: "## What and why\n\nChange.\n" })).join("\n"),
    /How it was checked/,
  );
});
test("an honest unverified limitation is allowed without claiming a review", async () => {
  assert.deepEqual(
    await evaluate({
      body: body.replace(
        "Local tests passed; portal journey remains unverified.",
        "Not run yet: local server is unavailable. No verification claimed.",
      ),
    }),
    [],
  );
});
test("an n/a assertion is not a validation report", async () => {
  assert.match(
    (
      await evaluate({
        body: body.replace(
          "Local tests passed; portal journey remains unverified.",
          "n/a — small change",
        ),
      })
    ).join("\n"),
    /actual validation/,
  );
});
test("duplicate description headings fail closed", async () => {
  assert.match(
    (
      await evaluate({ body: `${body}\n## WHAT AND WHY\n\nOther result.\n` })
    ).join("\n"),
    /appears more than once/,
  );
});
test("unfinished optional phase does not imply acceptance", () => {
  assert.equal(
    phaseSubmission(
      `${body}\n## Phase completion\n\n**Phase:** not submitted\n`,
    ),
    null,
  );
});
test("explicit phase claims return the exact report for source-bound validation", () => {
  assert.deepEqual(
    phaseSubmission(
      body +
        "\n## Phase completion\n\n**Phase:** P1\n**Report:** `docs/evidence/P1-review.json`\n",
    ),
    { phase: "P1", report: "docs/evidence/P1-review.json" },
  );
});
for (const claim of [
  "**Phase:** P1",
  "**Report:** docs/evidence/P1-review.json",
  "**Phase:** not submitted\n**Report:** docs/evidence/P1-review.json",
  "**Phase:** P1\n**Phase:** P2\n**Report:** docs/evidence/P1-review.json",
])
  test(`incomplete or contradictory phase fields fail: ${claim}`, () => {
    assert.throws(() =>
      phaseSubmission(`${body}\n## Phase completion\n\n${claim}`),
    );
  });
test("commented phase fields cannot submit or override the actual phase state", () => {
  assert.equal(
    phaseSubmission(
      body +
        "\n## Phase completion\n\n<!-- **Phase:** P1\n**Report:** docs/evidence/P1-review.json -->\n**Phase:** not submitted\n",
    ),
    null,
  );
});
