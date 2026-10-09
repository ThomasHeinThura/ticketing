import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anchorsOf, linksOf, liveStateIn, slugify } from "./check-policy.mjs";

describe("check:policy helpers", () => {
  it("slugs headings the way GitHub does for these files", () => {
    assert.equal(slugify("How work reaches `main`, and who may merge"), "how-work-reaches-main-and-who-may-merge");
    assert.equal(slugify("Sessions, handoff and continuation"), "sessions-handoff-and-continuation");
    assert.equal(slugify("4 · Verify"), "4--verify");
  });

  it("collects heading anchors, duplicates and explicit ids, but not fenced headings", () => {
    const anchors = anchorsOf(
      ["# A", "## Reviews", "## Reviews", '<a id="old-anchor"></a>', "```", "## Hidden", "```"].join("\n"),
    );
    assert.ok(anchors.has("reviews"));
    assert.ok(anchors.has("reviews-1"));
    assert.ok(anchors.has("old-anchor"));
    assert.ok(!anchors.has("hidden"));
  });

  it("finds relative links, skipping schemes, inline code and fences", () => {
    const links = linksOf(
      ["see [a](x.md#y) and [b](https://e.com) and `[c](z.md)`", "```", "[d](q.md)", "```"].join("\n"),
    );
    assert.deepEqual(links, [{ line: 1, target: "x.md#y" }]);
  });

  it("flags live state but not syntax examples or link targets", () => {
    const sha = "a".repeat(40);
    const found = liveStateIn(
      [
        `merged ${sha} today`,
        `**Reviewed head:** \`${sha}\``,
        "see #612 for details",
        "[anchor](#reviews) and [x](y.md#section-2)",
        "issue &#123; entity",
      ].join("\n"),
    );
    assert.deepEqual(
      found.map((entry) => `${entry.line}:${entry.what}`),
      ["1:a 40-character SHA", "3:a PR/issue number"],
    );
  });
});
