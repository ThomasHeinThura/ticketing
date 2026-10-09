import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSecurityReviewModels,
  ReviewModelsUnavailableError,
} from "./review-models.mjs";

const block = (lines) =>
  ["intro", "<!-- policy:security-review-models -->", ...lines, "<!-- /policy:security-review-models -->", "outro"].join("\n");

describe("parseSecurityReviewModels", () => {
  it("returns null when the document carries no block (bootstrap)", () => {
    assert.equal(parseSecurityReviewModels("# Agent workflow\n"), null);
  });

  it("reads exact labels in order", () => {
    assert.deepEqual(
      parseSecurityReviewModels(block(["- `GPT-6 Sol`", "", "- `Claude Opus 5.5 (claude-opus-5-5)`"])),
      ["GPT-6 Sol", "Claude Opus 5.5 (claude-opus-5-5)"],
    );
  });

  for (const [name, lines] of [
    ["an unfenced label", ["- GPT-6 Sol"]],
    ["prose inside the block", ["- `GPT-6 Sol`", "and anyone else"]],
    ["a padded label", ["- ` GPT-6 Sol`"]],
    ["an empty block", []],
    ["a repeated label", ["- `GPT-6 Sol`", "- `GPT-6 Sol`"]],
  ]) {
    it(`fails closed on ${name}`, () => {
      assert.throws(() => parseSecurityReviewModels(block(lines)), ReviewModelsUnavailableError);
    });
  }

  it("fails closed on a stray closing marker", () => {
    assert.throws(
      () => parseSecurityReviewModels("<!-- /policy:security-review-models -->\n"),
      ReviewModelsUnavailableError,
    );
  });

  it("fails closed on markers in the wrong order", () => {
    assert.throws(
      () =>
        parseSecurityReviewModels(
          "<!-- /policy:security-review-models -->\n- `GPT-6 Sol`\n<!-- policy:security-review-models -->\n",
        ),
      ReviewModelsUnavailableError,
    );
  });
});
