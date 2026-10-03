export function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Safe hrefs used when hydrating stored rich-text JSON. Pasted HTML is not the only
 * input path: API clients can submit marks directly, so stored links must be checked
 * again before they reach the DOM. */
function containsUnsafeUrlCharacters(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x5c || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function isSafeLinkUrl(value: string) {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    containsUnsafeUrlCharacters(value)
  ) {
    return false;
  }

  if (value.startsWith("/")) {
    return value === "/" || (value.length > 1 && value[1] !== "/");
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

export function isAppRelativeUrl(value: string) {
  return (
    value.startsWith("/") &&
    (value === "/" || (value.length > 1 && value[1] !== "/")) &&
    !containsUnsafeUrlCharacters(value)
  );
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
