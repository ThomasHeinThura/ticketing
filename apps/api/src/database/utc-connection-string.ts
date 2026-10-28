/** Legacy timestamp columns store UTC wall-clock values, including SQL defaults. */
export function withUtcDatabaseSession(connectionString: string): string {
  const url = new URL(connectionString);
  const options = url.searchParams.get("options");
  // pg's connection-string options override Pool.options, so enforce UTC here.
  // Keep operator-supplied startup settings; the final timezone setting wins.
  url.searchParams.set(
    "options",
    `${options ? `${options} ` : ""}-c TimeZone=UTC`,
  );
  return url.toString();
}
