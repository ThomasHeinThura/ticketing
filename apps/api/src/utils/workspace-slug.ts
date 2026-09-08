/**
 * Workspace slug generation. `workspace.slug` is NOT NULL UNIQUE
 * (`apps/api/src/database/schema.ts`) and the better-auth `organization()`
 * plugin was, until now, its only generator — it required the CALLER to
 * supply a unique slug and answered a collision with a 400 (retrofit plan
 * risk R8). The native create route generates one instead, so this is where
 * that generation lives.
 *
 * `slugifyWorkspaceName` is byte-for-byte the algorithm the web client
 * already uses (`apps/web/src/lib/utils/create-slug.ts`), deliberately: a
 * server that derived a different slug from the same name would make the
 * client's optimistic URL wrong.
 */

import { randomUUID } from "node:crypto";

const FALLBACK_SLUG = "workspace";

export function slugifyWorkspaceName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/[\s_-]+/g, "-") // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens

  // A name made entirely of characters the pattern above strips — "日本語",
  // "***" — slugifies to the empty string, which the NOT NULL UNIQUE column
  // would accept exactly once and then reject forever.
  return slug || FALLBACK_SLUG;
}

/**
 * The first slug in the `base`, `base-2`, `base-3`, … sequence that is not
 * already taken. Pure, so the collision policy is testable without a
 * database; the caller supplies the taken set and still handles the
 * unique-violation race (two creates can pass this at the same instant).
 */
export function nextAvailableSlug(
  base: string,
  taken: Iterable<string>,
): string {
  const takenSet = taken instanceof Set ? taken : new Set(taken);
  if (!takenSet.has(base)) {
    return base;
  }
  for (let suffix = 2; suffix <= takenSet.size + 2; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!takenSet.has(candidate)) {
      return candidate;
    }
  }
  // Unreachable for a finite taken set — the loop tries size+1 distinct
  // candidates — but a total function is cheaper than an assertion here.
  return `${base}-${takenSet.size + 2}`;
}

/**
 * A random slug for a create that LOST the unique-constraint race.
 *
 * Counting upward is right for the sequential case and wrong for the
 * concurrent one: every loser of a race re-reads the same state and picks the
 * same next number, so they collide again, and again, until the retry budget
 * runs out and somebody gets a 500. (Five concurrent creates of one name did
 * exactly that.) Dispersing the retries is what breaks the tie.
 *
 * `crypto.randomUUID` rather than `Math.random`: not for secrecy — the slug is
 * public — but because a weak generator under concurrency is how the same
 * collision comes back wearing a different hat.
 */
export function randomSlugSuffix(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}
