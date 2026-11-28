/** Rows of a SIT accounts file: a JSON array, or `{ accounts: [...] }` as release-helpers accepts. */
export function accountRows(text) {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed?.accounts;
  if (!Array.isArray(rows))
    throw new Error(
      "SIT_ACCOUNTS_FILE must be an array or { accounts: [...] }.",
    );
  return rows;
}
