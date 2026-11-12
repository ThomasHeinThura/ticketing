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
