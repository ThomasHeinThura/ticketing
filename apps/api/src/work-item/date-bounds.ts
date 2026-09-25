/**
 * The one shared range for every `work_item` date-time value this codebase accepts
 * or emits: `1900-01-01T00:00:00.000Z` .. `9999-12-31T23:59:59.999Z`, as millisecond
 * instants. `work_item.start_date`/`due_date` are Postgres `timestamp`, whose actual
 * range (4713 BC - 294276 AD) is far wider -- narrower on purpose, since nothing in
 * `work-items.md` calls for a date outside a normal calendar year (`schema.ts`'s
 * `workItemDateTime` has the full rationale, including the pre-1900 `timestamp`
 * driver-parser quirk this floor avoids).
 *
 * A standalone module (not exported from `schema.ts` or `list-query.ts` directly) so
 * both can import it without creating an import cycle between them -- `schema.ts`
 * needs `list-query.ts`'s `WORK_ITEM_SORT_FIELDS`/`WORK_ITEM_SORT_DIRECTIONS` for its
 * own query schema, and `list-query.ts` needs these bounds (#320 security review,
 * S1/S2: the SAME bounds the write path enforces, not a second, independently-typed
 * copy that could drift) for cursor validation -- a `schema.ts <-> list-query.ts`
 * cycle previously left `WORK_ITEM_SORT_FIELDS` undefined at `schema.ts`'s own
 * module-init time (`z.enum(undefined)` threw), caught live by the integration
 * suite.
 */
export const MIN_WORK_ITEM_INSTANT_MS = Date.UTC(1900, 0, 1, 0, 0, 0, 0);
export const MAX_WORK_ITEM_INSTANT_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
