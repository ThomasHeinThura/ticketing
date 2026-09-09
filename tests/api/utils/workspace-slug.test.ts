import { describe, expect, it } from "vitest";
import {
  nextAvailableSlug,
  randomSlugSuffix,
  slugifyWorkspaceName,
} from "../../../apps/api/src/utils/workspace-slug";

describe("slugifyWorkspaceName", () => {
  it("matches the client's createSlug for ordinary names", () => {
    // apps/web/src/lib/utils/create-slug.ts is the other half of this
    // contract: a server that derived a different slug from the same name
    // would make the client's optimistic URL wrong.
    expect(slugifyWorkspaceName("Acme Inc")).toBe("acme-inc");
    expect(slugifyWorkspaceName("  Spaced   Out  ")).toBe("spaced-out");
    expect(slugifyWorkspaceName("Under_scored")).toBe("under-scored");
    expect(slugifyWorkspaceName("Punctuation!?")).toBe("punctuation");
    expect(slugifyWorkspaceName("--Trimmed--")).toBe("trimmed");
  });

  it("falls back rather than returning an empty slug", () => {
    // `workspace.slug` is NOT NULL UNIQUE: an empty string would be accepted
    // exactly once and then collide forever.
    expect(slugifyWorkspaceName("日本語")).toBe("workspace");
    expect(slugifyWorkspaceName("***")).toBe("workspace");
    expect(slugifyWorkspaceName("   ")).toBe("workspace");
  });
});

describe("nextAvailableSlug", () => {
  it("returns the base when it is free", () => {
    expect(nextAvailableSlug("acme", [])).toBe("acme");
    expect(nextAvailableSlug("acme", ["other"])).toBe("acme");
  });

  it("counts upward past every taken variant", () => {
    expect(nextAvailableSlug("acme", ["acme"])).toBe("acme-2");
    expect(nextAvailableSlug("acme", ["acme", "acme-2"])).toBe("acme-3");
    expect(nextAvailableSlug("acme", ["acme", "acme-2", "acme-4"])).toBe(
      "acme-3",
    );
  });

  it("never returns a taken slug, however dense the range", () => {
    const taken = [
      "acme",
      ...Array.from({ length: 50 }, (_, i) => `acme-${i + 2}`),
    ];
    const chosen = nextAvailableSlug("acme", taken);
    expect(taken).not.toContain(chosen);
    expect(chosen.startsWith("acme")).toBe(true);
  });
});

describe("randomSlugSuffix", () => {
  it("is slug-safe", () => {
    for (let i = 0; i < 50; i++) {
      expect(randomSlugSuffix()).toMatch(/^[a-z0-9]{8}$/);
    }
  });

  it("disperses — which is the whole point of using it on retry", () => {
    // Counting upward made every loser of a concurrent create pick the same
    // next slug and collide again. These must not repeat.
    const seen = new Set(Array.from({ length: 500 }, () => randomSlugSuffix()));
    expect(seen.size).toBe(500);
  });
});
