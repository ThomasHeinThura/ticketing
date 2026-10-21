import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { currentWorkItemVersion } from "./work-item-save";

it("does not let an older detail cache override a newer displayed schedule version", () => {
  const client = new QueryClient();
  client.setQueryData(["work-items", "detail", "team-1"], { version: 3 });
  expect(currentWorkItemVersion(client, { key: "team-1", version: 5 })).toBe(5);
  client.setQueryData(["work-items", "detail", "team-1"], { version: 8 });
  expect(currentWorkItemVersion(client, { key: "team-1", version: 5 })).toBe(8);
});
