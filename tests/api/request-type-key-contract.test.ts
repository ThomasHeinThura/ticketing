import { describe, expect, it } from "vitest";
import {
  createRequestTypeBody,
  updateRequestTypeBody,
} from "../../apps/api/src/intake/schema";

// RT-0: the route key is server-generated and immutable; no request body can set or change it.
describe("request type key is not client-writable (RT-0)", () => {
  const create = {
    name: "Laptop request",
    group: "Hardware",
    workItemTypeId: "wit1",
    formSchema: { fields: [] },
  };

  it("rejects a key on create and on update", () => {
    expect(createRequestTypeBody.safeParse(create).success).toBe(true);
    expect(
      createRequestTypeBody.safeParse({ ...create, key: "laptop-request" })
        .success,
    ).toBe(false);
    expect(
      updateRequestTypeBody.safeParse({ version: 1, name: "Renamed" }).success,
    ).toBe(true);
    expect(
      updateRequestTypeBody.safeParse({ version: 1, key: "renamed" }).success,
    ).toBe(false);
  });
});
