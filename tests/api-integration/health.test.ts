import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";

describe("API integration: health", () => {
  it("responds with ok on /api/health", async () => {
    const { app } = createApp();

    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("responds with ok on /api/public/health/live, touching no dependency", async () => {
    const { app } = createApp();

    const response = await app.request("/api/public/health/live");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("responds with ok on /api/public/health/ready when the database is reachable", async () => {
    const { app } = createApp();

    const response = await app.request("/api/public/health/ready");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
