import {
  CAPABILITIES,
  CAPABILITY_NAMES,
  type Capability,
} from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { documentedCapabilities } from "./rbac-doc";

/**
 * `capabilities.ts` and rbac.md's capability table are one artefact.
 *
 * do-not 11: a capability has exactly one authoritative home, and it is rbac.md. Adding one to
 * the code without adding it to the document — or the reverse — fails here, in the same change.
 */

const documented = documentedCapabilities();

describe("capabilities.ts matches rbac.md", () => {
  it("declares exactly the capabilities the document lists", () => {
    expect([...CAPABILITY_NAMES].sort()).toEqual(
      documented.map((capability) => capability.name).sort(),
    );
  });

  it("puts each capability in the group the document puts it in", () => {
    for (const capability of documented) {
      expect(
        CAPABILITIES[capability.name as Capability].group,
        capability.name,
      ).toBe(capability.group);
    }
  });

  it("gives each capability the implications the document gives it", () => {
    for (const capability of documented) {
      expect(
        [...CAPABILITIES[capability.name as Capability].implies].sort(),
        capability.name,
      ).toEqual([...capability.implies].sort());
    }
  });

  it("carries the document's one-line description", () => {
    for (const capability of documented) {
      expect(
        CAPABILITIES[capability.name as Capability].description,
        capability.name,
      ).toBe(capability.description);
    }
  });

  it("invents no MCP capability, now or ever", () => {
    // "There are no MCP capabilities — no mcp:admin, mcp:read, mcp:write — and there never
    // will be." Effective MCP authority is the owner's RBAC intersected with the key's subset.
    for (const name of CAPABILITY_NAMES) {
      expect(name.startsWith("mcp:"), name).toBe(false);
    }
  });
});
