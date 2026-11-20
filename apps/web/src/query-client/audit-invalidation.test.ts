import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import { followAuditInvalidation } from "./audit-invalidation";
import {
  historyStamp,
  SETTINGS_HISTORY_KEY,
  withdrawHistoryOnRefusal,
} from "./settings-history-key";

function seeded() {
  const client = new QueryClient();
  followAuditInvalidation(client);
  for (const key of [
    ["work-items", "activity", "HELP-1"],
    ["work-items", "detail", "HELP-1"],
    ["work-items", "audit-history", "HELP-1"],
    ["work-items", "reconstruct", "HELP-1", "2026-10-23T00:00:00.000Z"],
    ["work-items", "audit-history", "HELP-2"],
  ])
    client.setQueryData(key, {});
  return client;
}

const invalidated = (client: QueryClient, key: unknown[]) =>
  client.getQueryState(key)?.isInvalidated;

describe("audit history follows work-item invalidation", () => {
  it("invalidates only that item's audit and reconstruct queries", async () => {
    const client = seeded();
    await client.invalidateQueries({
      queryKey: ["work-items", "activity", "HELP-1"],
    });
    expect(invalidated(client, ["work-items", "audit-history", "HELP-1"])).toBe(
      true,
    );
    expect(
      invalidated(client, [
        "work-items",
        "reconstruct",
        "HELP-1",
        "2026-10-23T00:00:00.000Z",
      ]),
    ).toBe(true);
    expect(invalidated(client, ["work-items", "audit-history", "HELP-2"])).toBe(
      false,
    );
  });

  it("follows a detail invalidation and a keyless activity invalidation", async () => {
    const client = seeded();
    await client.invalidateQueries({
      queryKey: ["work-items", "detail", "HELP-1"],
    });
    expect(invalidated(client, ["work-items", "audit-history", "HELP-1"])).toBe(
      true,
    );
    const other = seeded();
    await other.invalidateQueries({ queryKey: ["work-items", "activity"] });
    expect(invalidated(other, ["work-items", "audit-history", "HELP-1"])).toBe(
      true,
    );
  });
});

describe("history withdrawal on a refused query", () => {
  const stamp = () => historyStamp("any");
  it("advances the identity epoch for another query's 403 or 404 only", () => {
    const client = new QueryClient();
    const before = stamp();
    withdrawHistoryOnRefusal(
      client,
      { queryKey: ["x"] },
      new HttpError(500, "x"),
    );
    withdrawHistoryOnRefusal(
      client,
      { queryKey: [SETTINGS_HISTORY_KEY, "h"] },
      new HttpError(403, "own refusal"),
    );
    expect(stamp()).toBe(before);
    withdrawHistoryOnRefusal(
      client,
      { queryKey: ["x"] },
      new HttpError(404, "x"),
    );
    expect(stamp()).not.toBe(before);
  });
});
