import { describe, expect, it } from "vitest";
import {
  safeSmtpDiagnosticCode,
  smtpDiagnosticTranslationKey,
} from "./notification-provider";

describe("SMTP provider diagnostics", () => {
  it.each([
    "smtp_authentication_failed",
    "smtp_connection_failed",
    "smtp_tls_failed",
    "smtp_timeout",
  ] as const)("keeps the allowlisted %s code", (code) => {
    expect(safeSmtpDiagnosticCode(code)).toBe(code);
    expect(smtpDiagnosticTranslationKey(code)).toBe(`diagnostics.${code}`);
  });

  it("maps unknown provider text to the generic operation message", () => {
    const raw = "535 rejected synthetic-secret provider response";
    expect(safeSmtpDiagnosticCode(raw)).toBe("smtp_verification_failed");
    expect(smtpDiagnosticTranslationKey(raw)).toBe("operationFailed");
  });
});
