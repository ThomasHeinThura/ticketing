import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const smtp = vi.hoisted(() => ({
  sendMail: vi.fn(async () => ({ messageId: "controlled-message" })),
  createTransport: vi.fn(),
}));

vi.mock("dotenv-mono", () => ({ config: vi.fn() }));
vi.mock("nodemailer", () => ({
  createTransport: (...args: unknown[]) => {
    smtp.createTransport(...args);
    return smtp;
  },
}));
vi.mock("./smtp-config", () => ({
  getSmtpTransportOptions: vi.fn(() => ({})),
  isSmtpConfigured: vi.fn(() => true),
}));

import {
  sendMagicLinkEmail,
  sendNotificationEmail,
  sendOtpEmail,
  sendPasswordResetEmail,
  sendTrialReminderEmail,
  sendWorkspaceInvitationEmail,
} from "./send-email";
import { setRuntimeSmtpResolver } from "./smtp-runtime";

beforeEach(() => {
  smtp.sendMail.mockClear();
  smtp.createTransport.mockClear();
  vi.stubEnv("SMTP_FROM", "notifications@example.test");
});

afterEach(() => {
  setRuntimeSmtpResolver(undefined);
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

describe("sendWorkspaceInvitationEmail worker options", () => {
  it("forwards a bounded deadline and hashes the stable idempotency key into Message-ID", async () => {
    setRuntimeSmtpResolver(async () => ({
      options: { host: "runtime.example.test" },
      from: "notifications@example.test",
    }));
    const key = "customer-invitation-delivery:delivery-01";

    await expect(
      sendWorkspaceInvitationEmail(
        "person@example.test",
        "Invitation",
        {
          workspaceName: "Synthetic",
          inviterName: "Synthetic inviter",
          inviterEmail: "inviter@example.test",
          invitationLink: "https://portal.example.test/invite/one#t=secret",
          to: "person@example.test",
        },
        { deadlineMs: 5_000, idempotencyKey: key },
      ),
    ).resolves.toEqual({ success: true });

    const transportOptions = smtp.createTransport.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(transportOptions).toMatchObject({
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 5_000,
    });
    const messageOptions = smtp.sendMail.mock.calls.at(-1)?.[0];
    expect(messageOptions?.messageId).toMatch(
      /^<[a-f0-9]{64}@taskdesk\.invalid>$/u,
    );
    expect(messageOptions?.messageId).not.toContain(key);
  });

  it("runs the final delivery check before SMTP and skips when it expires", async () => {
    const sequence: string[] = [];
    setRuntimeSmtpResolver(async () => {
      sequence.push("resolveSmtp");
      return {
        options: { host: "runtime.example.test" },
        from: "notifications@example.test",
      };
    });
    const beforeSend = vi.fn(async () => {
      sequence.push("beforeSend");
      return false;
    });

    await expect(
      sendWorkspaceInvitationEmail(
        "person@example.test",
        "Invitation",
        {
          workspaceName: "Synthetic",
          inviterName: "Synthetic inviter",
          inviterEmail: "inviter@example.test",
          invitationLink: "https://portal.example.test/invite/one#t=secret",
          to: "person@example.test",
        },
        { deadlineMs: 5_000, beforeSend },
      ),
    ).resolves.toEqual({ success: false, reason: "NOT_AUTHORIZED" });

    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(sequence).toEqual(["resolveSmtp", "beforeSend"]);
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });
});

const templateSenders = [
  [
    "magic link",
    () =>
      sendMagicLinkEmail("person@example.test", "Magic link", {
        magicLink: "https://agent.example.test/sign-in",
      }),
  ],
  ["OTP", () => sendOtpEmail("person@example.test", "OTP", { otp: "123456" })],
  [
    "password reset",
    () =>
      sendPasswordResetEmail("person@example.test", "Reset", {
        resetLink: "https://agent.example.test/reset",
      }),
  ],
  [
    "invitation",
    () =>
      sendWorkspaceInvitationEmail("person@example.test", "Invitation", {
        workspaceName: "Synthetic",
        inviterName: "Synthetic inviter",
        inviterEmail: "inviter@example.test",
        invitationLink: "https://agent.example.test/invitation",
        to: "person@example.test",
      }),
  ],
  [
    "notification",
    () =>
      sendNotificationEmail("person@example.test", "Notification", {
        title: "Synthetic notification",
        message: "Synthetic contents",
      }),
  ],
  [
    "trial reminder",
    () =>
      sendTrialReminderEmail("person@example.test", "Trial", {
        workspaceName: "Synthetic",
        daysLeft: 1,
        billingUrl: "https://agent.example.test/billing",
      }),
  ],
] as const;

describe("all template sender configuration", () => {
  it.each(templateSenders)(
    "%s uses the current persisted sender and applies runtime changes to the next attempt",
    async (_name, send) => {
      for (const from of [
        "runtime-one@example.test",
        "runtime-two@example.test",
      ]) {
        setRuntimeSmtpResolver(async () => ({
          options: { host: "runtime.example.test" },
          from,
          replyTo: "reply@example.test",
        }));
        await send();
        expect(smtp.sendMail).toHaveBeenLastCalledWith(
          expect.objectContaining({
            from,
            replyTo: "reply@example.test",
            to: "person@example.test",
          }),
        );
      }
      expect(smtp.sendMail).toHaveBeenCalledTimes(2);
    },
  );
  it.each(templateSenders)(
    "%s never falls back to bootstrap for an explicit persisted disable",
    async (_name, send) => {
      setRuntimeSmtpResolver(async () => null);
      const outcome = await send().then(
        (value) => value,
        (error: unknown) => error,
      );
      if (outcome instanceof Error)
        expect(outcome).toMatchObject({ kind: "unavailable" });
      else
        expect(outcome).toEqual({
          success: false,
          reason: "SMTP_NOT_CONFIGURED",
        });
      expect(smtp.sendMail).not.toHaveBeenCalled();
    },
  );
  it.each(templateSenders)(
    "%s never falls back to bootstrap on a persisted configuration error",
    async (_name, send) => {
      setRuntimeSmtpResolver(async () => {
        throw new Error("Synthetic provider configuration unavailable");
      });
      await expect(send()).rejects.toThrow(
        "Synthetic provider configuration unavailable",
      );
      expect(smtp.sendMail).not.toHaveBeenCalled();
    },
  );
});
