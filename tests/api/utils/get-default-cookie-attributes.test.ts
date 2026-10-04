import { describe, expect, it } from "vitest";
import { getDefaultCookieAttributes } from "../../../apps/api/src/utils/get-default-cookie-attributes";

describe("getDefaultCookieAttributes", () => {
  it("uses host-only secure SameSite=Lax cookie attributes", () => {
    const attributes = getDefaultCookieAttributes();

    expect(attributes).toEqual({
      sameSite: "lax",
      secure: true,
      httpOnly: true,
      path: "/",
    });
  });
});
