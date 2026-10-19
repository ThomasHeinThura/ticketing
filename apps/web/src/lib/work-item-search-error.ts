/**
 * The user-facing message for a refused work-item search, by the status the endpoint
 * documents (api-design.md, Work-item search v1): `400` a malformed filter, `403` a field the
 * caller may not read, `422` a recognised field that is not available yet. The server's own
 * text is never shown; anything else (a failure, not a refusal) has no filter message.
 */
const KEYS: Record<number, string> = {
  400: "workItems:filter.errors.invalid",
  403: "workItems:filter.errors.forbidden",
  422: "workItems:filter.errors.unavailable",
};

export function workItemSearchErrorMessage(
  status: number,
  t: (key: string) => string,
): string | undefined {
  const key = KEYS[status];
  return key ? t(key) : undefined;
}
