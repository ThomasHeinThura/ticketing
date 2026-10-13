import type { TestInfo } from "@playwright/test";

type PlaywrightTestError = {
  errorContext?: string;
  cause?: PlaywrightTestError;
};

const OMITTED =
  "Page snapshot omitted because this workflow displays authentication secrets.";

function redact(error: PlaywrightTestError) {
  // TestInfoError.errorContext is Playwright's public switch for replacing its
  // automatic DOM/ARIA snapshot in the generated error-context.md artifact.
  error.errorContext = OMITTED;
  if (error.cause) redact(error.cause);
}

/**
 * Call from `test.afterEach` in every spec that renders MFA secrets (TOTP
 * provisioning URI, backup codes). Combined with trace, video and screenshot
 * off, a failing run then uploads no page content that could carry a secret.
 */
export function redactSecretErrorContext(testInfo: TestInfo) {
  for (const error of testInfo.errors as PlaywrightTestError[]) redact(error);
}
