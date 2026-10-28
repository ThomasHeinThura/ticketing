/** A `_test` suffix alone cannot identify disposable data: this live database has one. */
export function assertDisposableTestDatabaseUrl(
  connectionString: string,
): string {
  let url: URL;
  let database: string;
  try {
    url = new URL(connectionString);
    database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    throw new Error(
      "Integration fixtures require a valid PostgreSQL database URL",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !database.endsWith("_test") ||
    database === "taskdesk_browser_journey_1022_test"
  ) {
    throw new Error(
      "Refusing integration fixtures against a protected or non-test database",
    );
  }
  return database;
}
