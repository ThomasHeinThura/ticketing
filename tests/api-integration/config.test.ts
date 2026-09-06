import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";

describe("API integration: config", () => {
  it("returns the public config shape", async () => {
    const { app } = createApp();

    const response = await app.request("/api/config");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(payload).toMatchObject({
      disableRegistration: false,
      disablePasswordRegistration: false,
      disableEmailOtpSignIn: false,
      disableLoginForm: false,
      customOAuthAutoLogin: false,
      hasGuestAccess: true,
    });

    // isDemoMode left the public config with the cloud-only surfaces in #6.
    // Asserting its ABSENCE matters: it was driven by DEMO_MODE and paired
    // with a hardcoded `window.location.hostname === "demo.taskdesk.app"`
    // branch in the web bundle, which is what AGENTS.md rule 2 forbids.
    expect(payload).not.toHaveProperty("isDemoMode");
    expect(payload).not.toHaveProperty("billingEnabled");
    expect(payload).toSatisfy((value: Record<string, unknown>) =>
      [
        "hasSmtp",
        "hasGithubSignIn",
        "hasGoogleSignIn",
        "hasDiscordSignIn",
        "hasCustomOAuth",
      ].every((key) => typeof value[key] === "boolean"),
    );
  });
});
