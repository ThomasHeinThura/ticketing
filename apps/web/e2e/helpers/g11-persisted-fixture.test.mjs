import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertExactFixtureIds,
  CANONICAL_SELECTORS,
} from "./g11-persisted-fixture.ts";

test("exact membership refuses duplicate, missing and foreign persisted IDs", () => {
  assert.doesNotThrow(() => assertExactFixtureIds(["b", "a"], ["a", "b"]));
  for (const actual of [["a"], ["a", "a"], ["a", "foreign"]])
    assert.throws(() => assertExactFixtureIds(actual, ["a", "b"]));
  assert.throws(() => assertExactFixtureIds(["a", "b"], ["a", "a"]));
});
test("canonical selectors require Kaneo rows and exclude drag overlays and old tables", () => {
  assert.equal(
    CANONICAL_SELECTORS.list,
    '[data-testid="work-item-list-populated"] [data-task-id]',
  );
  assert.equal(
    CANONICAL_SELECTORS.board,
    '[data-testid="work-item-board-card"] [data-task-id]',
  );
  assert.equal(
    CANONICAL_SELECTORS.more,
    '[data-testid="work-item-list-load-more"]',
  );
});
