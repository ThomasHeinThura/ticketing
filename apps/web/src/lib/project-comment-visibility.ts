export type ProjectCommentVisibility = "public" | "internal";

/**
 * Return a comment-visibility value only when settings loaded successfully and
 * the user explicitly changed that field. This keeps the form's initial
 * fallback from overwriting a stored value during an unrelated project edit.
 */
export function getDefaultCommentVisibilityUpdate({
  storedValue,
  settingsLoaded,
  nextValue,
  fieldDirty,
}: {
  storedValue: ProjectCommentVisibility | undefined;
  settingsLoaded: boolean;
  nextValue: ProjectCommentVisibility;
  fieldDirty: boolean;
}): ProjectCommentVisibility | undefined {
  if (
    !settingsLoaded ||
    !fieldDirty ||
    !storedValue ||
    storedValue === nextValue
  ) {
    return undefined;
  }

  return nextValue;
}
