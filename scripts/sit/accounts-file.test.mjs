import assert from "node:assert/strict";
import { test } from "node:test";
import { accountRows } from "./accounts-file.mjs";

test("reads both accounts file shapes and refuses anything else", () => {
  const rows = [{ role: "owner" }, { role: "instance-admin" }];
  assert.deepEqual(accountRows(JSON.stringify(rows)), rows);
  assert.deepEqual(accountRows(JSON.stringify({ accounts: rows })), rows);
  assert.throws(() => accountRows(JSON.stringify({ users: rows })), /array/);
});
