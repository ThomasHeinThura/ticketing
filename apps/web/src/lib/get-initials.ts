// Uppercase before selecting characters: some characters expand when
// uppercased ("ß" -> "SS"), so uppercasing afterwards could yield more
// than two characters.
// Punctuation is dropped first, so "[audit] Invitee" gives "AI" rather than "[I" while
// "Mary-Jane Watson" and "O'Brien Smith" keep one word each ("MW", "OS").
export function getInitials(value: string | null | undefined, fallback = "??") {
  const parts =
    value
      ?.replace(/[^\p{L}\p{M}\p{N}\s]/gu, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean) ?? [];

  if (parts.length === 0) {
    return Array.from(fallback).slice(0, 2).join("").toUpperCase();
  }

  if (parts.length === 1) {
    return Array.from(parts[0].toUpperCase()).slice(0, 2).join("");
  }

  return parts
    .slice(0, 2)
    .map((part) => Array.from(part.toUpperCase())[0])
    .join("");
}
