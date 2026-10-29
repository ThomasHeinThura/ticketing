import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  verify: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  createTransport: () => transport,
}));

import { executeSmtp, SmtpAttemptError } from "./smtp-execution";

const config = {
  options: {},
  from: "sender@example.test",
};
const message = {
  to: "recipient@example.test",
  subject: "Synthetic message",
  text: "Synthetic content",
};

beforeEach(() => {
  transport.verify.mockReset();
  transport.sendMail.mockReset();
  transport.close.mockReset();
});

describe("SMTP provider timeout classification", () => {
  it.each([
    "CONNECT_TIMEOUT",
    "GREETING_TIMEOUT",
    "UPGRADE_TIMEOUT",
    "SOCKET_TIMEOUT",
  ])(
    "classifies %s during verification as an unambiguous deadline",
    async (timeoutType) => {
      transport.verify.mockRejectedValue(
        Object.assign(new Error("synthetic provider secret"), {
          code: "ETIMEDOUT",
          timeoutType,
        }),
      );
      const failure = await executeSmtp(config, null, {
        deadlineMs: 2000,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SmtpAttemptError);
      expect(failure).toMatchObject({
        kind: "deadline",
        ambiguous: false,
        message: "SMTP attempt deadline",
      });
      expect(String(failure)).not.toContain("synthetic provider secret");
      expect(transport.close).toHaveBeenCalledOnce();
    },
  );

  it("classifies a provider send timeout as an ambiguous deadline", async () => {
    transport.sendMail.mockRejectedValue(
      Object.assign(new Error("synthetic provider secret"), {
        code: "ETIMEDOUT",
        timeoutType: "SOCKET_TIMEOUT",
      }),
    );
    await expect(
      executeSmtp(config, message, { deadlineMs: 2000 }),
    ).rejects.toMatchObject({
      kind: "deadline",
      ambiguous: true,
      message: "SMTP attempt deadline",
    });
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it.each([
    [{ code: "ETIMEDOUT" }, "connection"],
    [{ code: "ETIMEDOUT", timeoutType: "UNKNOWN_TIMEOUT" }, "connection"],
    [{ code: "EAUTH", timeoutType: "GREETING_TIMEOUT" }, "authentication"],
    [{ code: "ERR_SSL_WRONG_VERSION_NUMBER" }, "tls"],
  ])("preserves failure diagnostics for %o", async (properties, diagnostic) => {
    transport.verify.mockRejectedValue(
      Object.assign(new Error("synthetic provider secret"), properties),
    );
    const failure = await executeSmtp(config, null, { deadlineMs: 2000 }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SmtpAttemptError);
    expect(failure).toMatchObject({
      kind: "failed",
      ambiguous: false,
      diagnostic,
      message: "SMTP attempt failed",
    });
    expect(String(failure)).not.toContain("synthetic provider secret");
    expect(transport.close).toHaveBeenCalledOnce();
  });
});
