/**
 * Codes a role delete is refused with, at request time and again at approval. Kept apart from the
 * roles fetcher so the shell's pending-action fetcher can use them without loading the roles
 * strings before the deferred namespace group.
 */
export const ROLE_REFUSAL_CODES = [
  "role_not_deletable",
  "role_in_use",
  "role_has_revoked_grants",
];
