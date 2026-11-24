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
