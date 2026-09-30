import { beforeEach, describe, expect, it, vi } from "vitest";

const { randomUUIDMock } = vi.hoisted(() => ({
  randomUUIDMock:
    vi.fn<() => `${string}-${string}-${string}-${string}-${string}`>(),
}));

vi.mock("node:crypto", () => ({ randomUUID: randomUUIDMock }));

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
  beforeEach(() => {
    randomUUIDMock.mockReset();
  });

  it("is slug-safe", () => {
    randomUUIDMock.mockReturnValue("01234567-89ab-cdef-0123-456789abcdef");

    expect(randomSlugSuffix()).toMatch(/^[a-z0-9]{8}$/);
  });

  it("uses fresh UUID bits for each retry", () => {
    randomUUIDMock
      .mockReturnValueOnce("00000001-0000-4000-8000-000000000000")
      .mockReturnValueOnce("00000002-0000-4000-8000-000000000000");

    const first = randomSlugSuffix();
    const second = randomSlugSuffix();

    expect(first).toBe("00000001");
    expect(second).toBe("00000002");
    expect(second).not.toBe(first);
    expect(randomUUIDMock).toHaveBeenCalledTimes(2);
  });
});
