import { isDeepStrictEqual } from "node:util";

/** Keep Playwright's rejected fill call log from including generated credentials. */
export async function fillSensitive(
  locator: { fill(value: string): Promise<void> },
  value: string,
): Promise<void> {
  try {
    await locator.fill(value);
  } catch {
    throw new Error("Sensitive form input failed.");
  }
}

/** Suppress Playwright request call logs, which can include session cookies. */
export async function privateRequest<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error("Sensitive API request failed.");
  }
}

/** Assert a secret field is empty; toHaveValue("") would print the leftover value. */
export async function expectCleared(
  locator: { inputValue(): Promise<string> },
  expectFn: typeof import("@playwright/test").expect,
): Promise<void> {
  await expectFn
    .poll(async () => (await locator.inputValue()) === "", {
      message: "Sensitive field was not cleared.",
    })
    .toBe(true);
}

/**
 * Assert a private check. Callers compute `ok` with plain JS so no Playwright
 * expect ever sees the value: expect records its own failure message in the
 * test step (and HTML report), and that message can hold a secret or a body.
 */
export function expectPrivately(
  ok: boolean | (() => boolean),
  message: string,
): void {
  // Plain throw: tests/e2e has no @playwright/test to import, and nothing is recorded.
  if (!(typeof ok === "function" ? ok() : ok)) throw new Error(message);
}

/** Partial deep match like toMatchObject: objects by key, arrays by index. */
export function matchesPartial(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => matchesPartial(actual[index], item))
    );
  if (
    expected !== null &&
    typeof expected === "object" &&
    Object.getPrototypeOf(expected) === Object.prototype
  )
    return (
      actual !== null &&
      typeof actual === "object" &&
      Object.entries(expected).every(([key, value]) =>
        matchesPartial((actual as Record<string, unknown>)[key], value),
      )
    );
  return isDeepStrictEqual(actual, expected);
}
