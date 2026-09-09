import { describe, expect, it } from "vitest";
import { authClient } from "@/lib/auth-client";
import { refreshWorkspaceStores } from "./refresh-workspace-stores";

/**
 * The ONLY test that exercises `refreshWorkspaceStores` against the REAL
 * better-auth client.
 *
 * Why it has to exist, found independently by two reviewers of PR #85. All
 * three consuming hook test files `vi.mock` this module away — deliberately, so
 * they can assert *whether* it runs — which means nothing in the suite ever
 * executed its body. And TypeScript gives no protection either: `$store.notify`
 * takes a bare `string`, so a typo or a renamed atom is not a compile error.
 *
 * The failure that would otherwise reach production: a future better-auth bump,
 * landing before #76 deletes this shim, renames or removes the `$listOrg` /
 * `$activeOrgSignal` atoms. `pnpm test`, `typecheck` and `lint:ci` all stay
 * green because nothing touches the real client. Then the first workspace
 * rename, create or delete after the bump throws a `TypeError` out of the
 * mutation — because `$store.notify` indexes `pluginsAtoms[signal]` directly
 * and does not guard the lookup.
 *
 * So these assertions are deliberately about the CONTRACT WITH THE LIBRARY
 * rather than about our own logic, and they are the reason the module's own
 * comment ("a typo here throws at runtime rather than failing quietly") is a
 * statement someone checks instead of a hope.
 *
 * **This file is deleted together with the shim when #76 (S3) repoints the
 * workspace reads off the plugin's stores.**
 */
describe("refreshWorkspaceStores", () => {
  it("names atoms that actually exist on the installed better-auth client", () => {
    // The direct form of the contract: if a bump renames either atom, this
    // fails here with a readable message rather than as a TypeError in a
    // browser.
    //
    // Asserted by PROPERTY ACCESS, not by `Object.keys`. A first version of
    // this test used `Object.keys(atoms)` and failed against a client whose
    // atoms are plainly present and working — the collection does not enumerate
    // the way a plain object would. Property access is also exactly what
    // `$store.notify` does (`pluginsAtoms[signal].set(...)`), so this asserts
    // the operation the shim actually performs rather than a property of the
    // container that happens to correlate with it.
    const atoms = authClient.$store.atoms as Record<string, unknown>;

    expect(atoms.$listOrg, "$listOrg atom is missing").toBeDefined();
    expect(
      atoms.$activeOrgSignal,
      "$activeOrgSignal atom is missing",
    ).toBeDefined();
  });

  it("runs against the real client without throwing", () => {
    // `$store.notify` does `pluginsAtoms[signal].set(!pluginsAtoms[signal].get())`
    // with no guard, so an unknown signal is a TypeError on the spot. Calling it
    // for real is the whole point of this test — a mocked client would prove
    // nothing about the names.
    expect(() => refreshWorkspaceStores()).not.toThrow();
  });

  it("actually flips both atoms, so a no-op implementation would be caught", () => {
    // Without this, an implementation that silently did nothing would satisfy
    // the two assertions above. The atoms are booleans that `notify` inverts.
    const atoms = authClient.$store.atoms as Record<
      string,
      { get: () => unknown }
    >;

    const before = {
      list: atoms.$listOrg?.get(),
      active: atoms.$activeOrgSignal?.get(),
    };

    refreshWorkspaceStores();

    expect(atoms.$listOrg?.get()).not.toBe(before.list);
    expect(atoms.$activeOrgSignal?.get()).not.toBe(before.active);
  });
});
