import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const smtp = vi.hoisted(() => ({
  sendMail: vi.fn(async () => ({ messageId: "controlled-message" })),
}));

vi.mock("dotenv-mono", () => ({ config: vi.fn() }));
vi.mock("nodemailer", () => ({
  createTransport: vi.fn(() => smtp),
}));
vi.mock("./smtp-config", () => ({
  getSmtpTransportOptions: vi.fn(() => ({})),
  isSmtpConfigured: vi.fn(() => true),
}));

import { sendNotificationEmail } from "./send-email";

beforeEach(() => {
  smtp.sendMail.mockClear();
  vi.stubEnv("SMTP_FROM", "notifications@example.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendNotificationEmail authorization boundary", () => {
  it("rechecks after rendering and skips SMTP when reach is revoked during the async check", async () => {
    let releaseAuthorization: (() => void) | undefined;
    let markAuthorizationStarted: (() => void) | undefined;
    const authorizationStarted = new Promise<void>((resolve) => {
      markAuthorizationStarted = resolve;
    });
    const authorizationGate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    let currentlyAuthorized = true;
    const authorize = vi.fn(async () => {
      markAuthorizationStarted?.();
      await authorizationGate;
      return currentlyAuthorized;
    });

    const pendingSend = sendNotificationEmail(
      "person@example.test",
      "Task updated",
      { title: "Task updated", message: "The task changed." },
      { authorize },
    );

    await authorizationStarted;
    currentlyAuthorized = false;
    releaseAuthorization?.();

    await expect(pendingSend).resolves.toEqual({
      success: false,
      reason: "NOT_AUTHORIZED",
    });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it("sends a rendered notification when the final authorization check allows it", async () => {
    const authorize = vi.fn(async () => true);

    await expect(
      sendNotificationEmail(
        "person@example.test",
        "Task updated",
        { title: "Task updated", message: "The task changed." },
        { authorize },
      ),
    ).resolves.toEqual({ success: true });

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "notifications@example.test",
        to: "person@example.test",
        subject: "Task updated",
        html: expect.stringContaining("The task changed."),
      }),
    );
  });
});
