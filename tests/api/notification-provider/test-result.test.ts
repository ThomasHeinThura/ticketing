import { describe, expect, it } from "vitest";
import {
  classifySmtpTestFailure,
  recipientDomain,
} from "../../../apps/api/src/notification-provider/test-result";
import {
  SmtpAttemptError,
  type SmtpReply,
} from "../../../packages/email/dist/smtp-runtime";

const failed = (
  reply?: Partial<SmtpReply>,
  diagnostic?: "authentication" | "connection" | "tls",
) =>
  new SmtpAttemptError(
    "failed",
    false,
    diagnostic,
    reply ? { code: null, command: null, text: null, ...reply } : undefined,
  );

describe("test send failure classification", () => {
  it.each([
    [
      "535 wrong SMTP credentials",
      failed(
        {
          code: 535,
          command: "AUTH PLAIN",
          text: "5.7.8 Authentication Credentials Invalid",
        },
        "authentication",
      ),
      "authentication",
      535,
    ],
    [
      "535 without the command",
      failed({ code: 535, text: "Authentication Credentials Invalid" }),
      "authentication",
      535,
    ],
    [
      "554 sender or recipient not verified",
      failed({
        code: 554,
        command: "MAIL FROM",
        text: "Message rejected: Email address is not verified.",
      }),
      "message_rejected",
      554,
    ],
    [
      "454 throttled",
      failed({
        code: 454,
        command: "DATA",
        text: "4.7.0 Throttling failure: Maximum sending rate exceeded",
      }),
      "throttled",
      454,
    ],
    [
      "454 temporary authentication failure",
      failed({ code: 454, command: "AUTH PLAIN" }, "authentication"),
      "temporary",
      454,
    ],
    ["530 STARTTLS required", failed({ code: 530 }), "starttls_required", 530],
    [
      "a server that refuses the STARTTLS command",
      failed({ code: 502, command: "STARTTLS" }, "tls"),
      "starttls_required",
      502,
    ],
    [
      "another 4xx",
      failed({ code: 451, command: "RCPT TO" }),
      "temporary",
      451,
    ],
    ["another 5xx", failed({ code: 550, command: "RCPT TO" }), "rejected", 550],
    ["host unreachable", failed(undefined, "connection"), "connection", null],
    ["a certificate problem", failed(undefined, "tls"), "tls", null],
    [
      "authentication without a reply",
      failed(undefined, "authentication"),
      "authentication",
      null,
    ],
    ["an unrecognised failure", failed(), "failed", null],
  ] as const)("maps %s", (_name, error, category, smtpCode) => {
    expect(classifySmtpTestFailure(error)).toMatchObject({
      category,
      smtpCode,
    });
  });

  it("maps the attempt deadline to a timeout and a rejected message to rejected", () => {
    expect(classifySmtpTestFailure(new SmtpAttemptError("deadline"))).toEqual({
      category: "timeout",
      smtpCode: null,
      providerText: null,
    });
    expect(classifySmtpTestFailure(new SmtpAttemptError("rejected"))).toEqual({
      category: "rejected",
      smtpCode: null,
      providerText: null,
    });
  });

  it("passes the already sanitised provider text through and reports nothing for foreign errors", () => {
    expect(
      classifySmtpTestFailure(
        failed({ code: 554, text: "Email address is not verified. [removed]" }),
      ).providerText,
    ).toBe("Email address is not verified. [removed]");
    expect(classifySmtpTestFailure(new Error("socket hang up"))).toEqual({
      category: "failed",
      smtpCode: null,
      providerText: null,
    });
    expect(classifySmtpTestFailure("boom")).toEqual({
      category: "failed",
      smtpCode: null,
      providerText: null,
    });
  });
});

describe("recipient domain", () => {
  it("keeps only the lower-cased part after the last @", () => {
    expect(recipientDomain("Admin@Example.TEST")).toBe("example.test");
    expect(recipientDomain("a@b@Example.test")).toBe("example.test");
  });
});
