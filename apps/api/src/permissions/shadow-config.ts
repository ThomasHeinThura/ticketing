/**
 * The switch for issue #8 Slice 2's shadow-mode middleware.
 *
 * `TASKDESK_POLICY_SHADOW` (`docs/05-operations/configuration-reference.md`, "Optional"),
 * following `TASKDESK_STORAGE_DRIVER`'s precedent as a narrow, interim bootstrap bridge:
 * `plugin-architecture.md`'s "Feature toggles" mechanism (`instance_feature_flag` and its
 * two per-scope tables, resolved through `packages/permissions/src/features.ts`) is
 * specified but **not implemented anywhere in this codebase yet** — building it is a
 * separate, P4 governance-seam piece, not something this slice can casually add. This
 * variable is expected to be superseded by that mechanism once it exists, exactly the way
 * `TASKDESK_STORAGE_DRIVER`'s own entry describes its own relationship to the real Storage
 * plugin config.
 *
 * Read and validated ONCE, at module load — an unrecognised value is a startup-time
 * configuration error (thrown from this module, which `index.ts` imports at module scope),
 * never silently rounded to `off`. `pnpm check:env` requires the environment read below to
 * be a literal member access on the variable name it names, attributable to the approved
 * entry in `configuration-reference.md`.
 */

const RAW = process.env.TASKDESK_POLICY_SHADOW;

export class PolicyShadowConfigError extends Error {}

function parse(value: string | undefined): boolean {
  if (value === undefined || value === "") {
    return false;
  }
  if (value === "off") {
    return false;
  }
  if (value === "on") {
    return true;
  }
  throw new PolicyShadowConfigError(
    `TASKDESK_POLICY_SHADOW must be "on" or "off" (or unset, which means "off"); got ${JSON.stringify(value)}`,
  );
}

/**
 * `true` when the shadow middleware should evaluate and log. Computed once, at import time,
 * so a bad value fails the same boot path `policyRegistry`'s own construction does — before
 * `listen()`, not on the first request that happens to reach the shadow middleware.
 */
export const policyShadowEnabled: boolean = parse(RAW);
