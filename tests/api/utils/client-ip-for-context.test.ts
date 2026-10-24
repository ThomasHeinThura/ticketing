import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientIpForContext } from "../../../apps/api/src/api-key/enforce";

/**
 * Audit rows must not record a caller-chosen X-Forwarded-For: the helper counts trusted hops
 * from the right (default one), so the leftmost, attacker-supplied entries never win.
 */
describe("clientIpForContext", () => {
  const app = new Hono().get("/ip", (c) =>
    c.json({ ip: clientIpForContext(c) }),
  );

  it("ignores caller-invented entries left of the trusted proxy hop", async () => {
    const response = await app.request("/ip", {
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.1" },
    });
    expect(((await response.json()) as { ip: string | null }).ip).not.toBe(
      "6.6.6.6",
    );
  });

  it("does not echo the raw header when it is not a plausible address", async () => {
    const response = await app.request("/ip", {
      headers: { "x-forwarded-for": "<script>alert(1)</script>" },
    });
    expect(((await response.json()) as { ip: string | null }).ip).toBeNull();
  });

  it("does not return the raw multi-entry header", async () => {
    const response = await app.request("/ip", {
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" },
    });
    const { ip } = (await response.json()) as { ip: string | null };
    expect(ip === null || !ip.includes(",")).toBe(true);
  });
});
