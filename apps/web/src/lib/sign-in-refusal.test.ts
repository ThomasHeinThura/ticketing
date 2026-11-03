import { describe, expect, it } from "vitest";
import { signInRefusalKey } from "./sign-in-refusal";

describe("signInRefusalKey (A-05)", () => {
  it("maps the customer-portal refusal to its translated message", () => {
    expect(
      signInRefusalKey({ code: "USE_CUSTOMER_PORTAL", message: "raw" }),
    ).toBe("auth:wrongPortal.useCustomerPortal");
  });

  it("maps both portal-host refusals to their translated messages", () => {
    expect(signInRefusalKey({ code: "USE_AGENT_SIGN_IN" })).toBe(
      "auth:wrongPortal.useAgentSignIn",
    );
    expect(signInRefusalKey({ code: "CUSTOMER_PORTAL_UNAVAILABLE" })).toBe(
      "auth:wrongPortal.customerPortalUnavailable",
    );
  });

  it("leaves every other error to the form's own message", () => {
    expect(signInRefusalKey({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBeNull();
    expect(signInRefusalKey({ message: "no code" })).toBeNull();
    expect(signInRefusalKey(null)).toBeNull();
    expect(signInRefusalKey("USE_CUSTOMER_PORTAL")).toBeNull();
    expect(signInRefusalKey({ code: "toString" })).toBeNull();
  });
});
