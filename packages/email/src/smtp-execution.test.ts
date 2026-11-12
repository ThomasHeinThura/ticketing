import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  verify: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  createTransport: () => transport,
}));

import {
  executeSmtp,
  SmtpAttemptError,
  sanitiseSmtpReplyText,
} from "./smtp-execution";

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

describe("SMTP reply sanitising", () => {
  it.each([
    [
      "535 5.7.8 Authentication Credentials Invalid",
      "5.7.8 Authentication Credentials Invalid",
    ],
    [
      "554 Message rejected: Email address is not verified. The following identities failed the check in region EU-WEST-1: sender@example.test, other@example.org",
      "Message rejected: Email address is not verified. The following identities failed the check in region EU-WEST-1: [removed], [removed]",
    ],
    [
      "550 5.7.1 Client host [203.0.113.7] blocked, see mail.provider.example for details",
      "5.7.1 Client host [removed] blocked, see [removed] for details",
    ],
    [
      "421 4.4.2 connection from 2001:db8::1 refused by relay-1.eu-west-1.amazonaws.com",
      "4.4.2 connection from [removed] refused by [removed]",
    ],
    [
      "535 Authentication failed for AKIAIOSFODNN7EXAMPLE",
      "Authentication failed for [removed]",
    ],
    [
      "250 Ok 0100019abcdef0123456789abcdef0123456789abcdef-01234567-89ab",
      "Ok [removed]",
    ],
  ])("removes addresses, hosts, IPs and tokens from %j", (input, expected) => {
    expect(sanitiseSmtpReplyText(input)).toBe(expected);
  });

  it("removes the configured credentials verbatim, including short values", () => {
    expect(
      sanitiseSmtpReplyText(
        "535 login failed for synthetic-user with pw-Synthetic-Secret-1",
        ["synthetic-user", "pw-Synthetic-Secret-1", "ab", undefined, null],
      ),
    ).toBe("login failed for [removed] with [removed]");
    expect(sanitiseSmtpReplyText("535 ab abc", ["ab"])).toBe(
      "[removed] [removed]c",
    );
  });

  it("strips control characters, bounds the length and reports nothing readable as null", () => {
    expect(sanitiseSmtpReplyText("554 one\r\ntwo\u0000three")).toBe(
      "one two three",
    );
    const long = sanitiseSmtpReplyText(`554 ${"word ".repeat(100)}`);
    expect(long).toHaveLength(200);
    expect(long?.endsWith("…")).toBe(true);
    expect(sanitiseSmtpReplyText("535 ")).toBeNull();
    expect(sanitiseSmtpReplyText("   ")).toBeNull();
  });

  it("attaches the sanitised reply only when the caller asks for it", async () => {
    const providerFailure = () =>
      Object.assign(new Error("Invalid login: 535 synthetic-user rejected"), {
        code: "EAUTH",
        command: "AUTH PLAIN",
        response: "535 5.7.8 Authentication failed for synthetic-user",
        responseCode: 535,
      });
    const smtp = {
      options: {
        host: "email-smtp.eu-west-1.amazonaws.com",
        auth: { user: "synthetic-user", pass: "synthetic-password-1" },
      },
      from: "sender@example.test",
    };
    transport.sendMail.mockRejectedValue(providerFailure());
    const plain = await executeSmtp(smtp, message, { deadlineMs: 2000 }).catch(
      (error: unknown) => error,
    );
    expect(plain).toMatchObject({
      kind: "failed",
      diagnostic: "authentication",
    });
    expect((plain as SmtpAttemptError).reply).toBeUndefined();

    transport.sendMail.mockRejectedValue(providerFailure());
    const withReply = await executeSmtp(smtp, message, {
      deadlineMs: 2000,
      includeReply: true,
    }).catch((error: unknown) => error);
    expect(withReply).toBeInstanceOf(SmtpAttemptError);
    expect((withReply as SmtpAttemptError).reply).toEqual({
      code: 535,
      command: "AUTH PLAIN",
      text: null,
    });
    expect(JSON.stringify(withReply)).not.toContain("synthetic-user");
    expect(JSON.stringify(withReply)).not.toContain("synthetic-password-1");
    expect(String(withReply)).not.toContain("synthetic-user");
  });

  it("drops oversized replies without exposing boundary fragments", () => {
    for (const value of [
      "pw-Synthetic-Secret-1",
      "user@example.test",
      "smtp.example.test",
    ]) {
      expect(
        sanitiseSmtpReplyText(`535 ${" ".repeat(1988)}${value}`, [value]),
      ).toBeNull();
    }
  });

  it("never propagates an SMTP command containing an authentication payload", async () => {
    transport.sendMail.mockRejectedValue(
      Object.assign(new Error("failure"), {
        code: "EAUTH",
        command: "AUTH PLAIN SECRET",
        response: "535 refused",
        responseCode: 535,
      }),
    );
    const error = await executeSmtp(
      {
        options: { auth: { user: "user", pass: "secret" } },
        from: "sender@example.test",
      },
      message,
      { includeReply: true },
    ).catch((cause: unknown) => cause);
    expect((error as SmtpAttemptError).reply).toEqual({
      code: 535,
      command: null,
      text: null,
    });
    expect(JSON.stringify(error)).not.toContain("SECRET");
  });

  it.each([
    "pw-Synth",
    "synthetic-user",
    "c3ludGhldGljLXVzZXI=",
    "AUTH PLAIN c2VjcmV0",
    "synthetic-password-1",
  ])("does not expose echoed authentication content %s", async (echo) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    transport.sendMail.mockRejectedValue(
      Object.assign(new Error(echo), {
        code: "EAUTH",
        command: "AUTH PLAIN",
        response: `535 ${echo}`,
        responseCode: 535,
      }),
    );
    const error = await executeSmtp(
      {
        options: {
          host: "smtp.example.test",
          auth: { user: "synthetic-user", pass: "synthetic-password-1" },
        },
        from: "sender@example.test",
      },
      message,
      { includeReply: true },
    ).catch((cause: unknown) => cause);
    expect((error as SmtpAttemptError).reply).toEqual({
      code: 535,
      command: "AUTH PLAIN",
      text: null,
    });
    expect(JSON.stringify(error)).not.toContain(echo);
    expect(
      JSON.stringify([log.mock.calls, warn.mock.calls, errorLog.mock.calls]),
    ).not.toContain(echo);
    log.mockRestore();
    warn.mockRestore();
    errorLog.mockRestore();
  });

  it("reads the code from the reply text when the error carries no numeric code and keeps nothing for a bare error", async () => {
    transport.sendMail.mockRejectedValue(
      Object.assign(new Error("x"), {
        code: "EENVELOPE",
        response: "454 4.7.0 Throttling failure: Maximum sending rate exceeded",
      }),
    );
    const throttled = await executeSmtp(config, message, {
      deadlineMs: 2000,
      includeReply: true,
    }).catch((error: unknown) => error);
    expect((throttled as SmtpAttemptError).reply).toEqual({
      code: 454,
      command: null,
      text: "4.7.0 Throttling failure: Maximum sending rate exceeded",
    });

    transport.sendMail.mockRejectedValue(new Error("socket hang up"));
    const bare = await executeSmtp(config, message, {
      deadlineMs: 2000,
      includeReply: true,
    }).catch((error: unknown) => error);
    expect((bare as SmtpAttemptError).reply).toBeUndefined();
  });

  it("classifies a failed STARTTLS upgrade as a TLS problem", async () => {
    transport.verify.mockRejectedValue(
      Object.assign(new Error("Error initiating TLS"), { code: "ETLS" }),
    );
    await expect(
      executeSmtp(config, null, { deadlineMs: 2000 }),
    ).rejects.toMatchObject({ kind: "failed", diagnostic: "tls" });
  });
});
