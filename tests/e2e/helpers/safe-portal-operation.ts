/** Do not let Playwright transport errors print signed URLs or session cookies. */
export async function safePortalOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error(
      "Portal attachment operation failed; sensitive details omitted.",
    );
  }
}
