/** Opaque tab identifiers are correlation hints, never authentication credentials. */
export function validWindowId(value: string | undefined): string | undefined {
  return value && value.length <= 64 && !/[^A-Za-z0-9_-]/.test(value)
    ? value
    : undefined;
}

/** Build the correlation hint only for an authenticated browser session. */
export function browserWindowOrigin(
  userId: string,
  raw: string | undefined,
  session: boolean,
) {
  const windowId = validWindowId(raw);
  return session && userId && windowId ? { userId, windowId } : undefined;
}

export function legacyWindowOrigin(userId: string, raw: string | undefined) {
  const windowId = validWindowId(raw);
  return windowId ? `${userId}:${windowId}` : undefined;
}
