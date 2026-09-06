/**
 * Compile-time negative tests for the policy union.
 *
 * Not runtime tests: `tsc` checks these during `pnpm --filter @taskdesk/permissions build` (and
 * during `pnpm exec tsc --noEmit`), which every `test:permissions` turbo task depends on
 * (`turbo.json`'s `dependsOn: ["^build"]`). This file is type-only and emits an empty module.
 *
 * `Rejects<T>` asserts that `T` is **not assignable** to `Policy` — stronger than
 * excess-property checking, and independent of where `tsc` chooses to report an error. If the
 * type ever stops rejecting a shape, the assertion fails with `Type 'false' does not satisfy
 * the constraint 'true'`, naming the constraint that was lost.
 */

import type { Policy } from "./policy";

type Assert<T extends true> = T;
type Accepts<T> = [T] extends [Policy] ? true : false;
type Rejects<T> = [T] extends [Policy] ? false : true;

/** A public route's `elevated: false` is a written waiver, not a constraint — it must stay legal. */
export type PublicWaiverIsLegal = Assert<
  Accepts<{
    readonly public: true;
    readonly reason: string;
    readonly elevated: false;
    readonly elevationExemptionReason: string;
  }>
>;

/** Kind 4 has no caller to re-authenticate. */
export type PublicCannotBeElevated = Assert<
  Rejects<{
    readonly public: true;
    readonly reason: string;
    readonly elevated: true;
  }>
>;

/** Kind 4 accepts a request carrying no credential at all: there is no session to require. */
export type PublicCannotBeSessionOnly = Assert<
  Rejects<{
    readonly public: true;
    readonly reason: string;
    readonly sessionOnly: true;
  }>
>;

/** Kind 5 does have a caller, so both flags are real constraints there and stay declarable. */
export type DelegatedMayDeclareBothFlags = Assert<
  Accepts<{
    readonly delegated: "scim";
    readonly reason: string;
    readonly elevated: true;
    readonly sessionOnly: true;
  }>
>;

/** A capability policy that omits `reach` is the omission this registry exists to refuse. */
export type CapabilityMustDeclareReach = Assert<
  Rejects<{
    readonly capability: "project:read";
    readonly scope: "project";
  }>
>;

/** A self policy that omits `personParam` is the same omission, on kind 2. */
export type SelfMustDeclarePersonParam = Assert<
  Rejects<{
    readonly authenticated: true;
    readonly self: true;
  }>
>;

/**
 * A capability policy that omits `scopeSource` is the same omission again — finding 4's
 * completion. This object is otherwise complete (`capability`, `scope`, `reach` all present) so
 * the rejection is attributable to the missing field alone.
 */
export type CapabilityMustDeclareScopeSource = Assert<
  Rejects<{
    readonly capability: "project:read";
    readonly scope: "project";
    readonly reach: "required";
  }>
>;
