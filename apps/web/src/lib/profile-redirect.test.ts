import { describe, expect, it } from "vitest";
import { profileRedirectTarget } from "./profile-redirect";

describe("profileRedirectTarget", () => {
  it("sends the profile root to account information", () => {
    expect(profileRedirectTarget("/agent/settings/profile")).toBe(
      "/dashboard/settings/account/information",
    );
    expect(profileRedirectTarget("/agent/settings/profile/")).toBe(
      "/dashboard/settings/account/information",
    );
  });

  it("sends the documented api-keys route to the developer page", () => {
    expect(profileRedirectTarget("/agent/settings/profile/api-keys")).toBe(
      "/dashboard/settings/account/developer",
    );
  });

  it("leaves real profile routes alone", () => {
    expect(
      profileRedirectTarget("/agent/settings/profile/notifications"),
    ).toBeUndefined();
  });
});
