/** Drafts that may hold private text and must not outlive a sign-out. */
export const DRAFT_KEY_PREFIXES = [
  "taskdesk:comment-draft:",
  "taskdesk:intake-draft:",
];

/** Remove every localStorage key starting with one of the prefixes. */
export function clearStoredKeys(prefixes: string[] = DRAFT_KEY_PREFIXES) {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key && prefixes.some((prefix) => key.startsWith(prefix)))
        keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable; nothing to clear.
  }
}
