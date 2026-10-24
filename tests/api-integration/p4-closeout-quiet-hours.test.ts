/**
 * NO-3: a staff person saves their own quiet-hours window (HH:MM, HH:MM, IANA zone) through the
 * existing session-only preferences route; the window is read back and stored on their own
 * person row, which the external-delivery drain already evaluates. Digests stay closed.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { evaluateQuietHours } from "../../apps/api/src/notification/quiet-hours";
import { mockAuthenticatedSession } from "./helpers/auth";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const put = (app: ReturnType<typeof createApp>["app"], body: unknown) =>
  app.request("/api/notification-preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("quiet hours write route", () => {
  beforeEach(async () => resetTestDatabase());

  it("saves, returns and clears the caller's own window", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const other = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const window = { start: "22:00", end: "07:00", timezone: "Europe/Berlin" };
    const saved = await put(app, { quietHours: window });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(
      ((await saved.json()) as { quietHours: unknown }).quietHours,
    ).toEqual(window);
    const read = await app.request("/api/notification-preferences");
    expect(((await read.json()) as { quietHours: unknown }).quietHours).toEqual(
      window,
    );
    // Stored on the caller's person row only, in the shape the delivery drain evaluates.
    const people = await db.select().from(schema.personTable);
    const mine = people.find((row) => row.userId === member.user.id);
    const theirs = people.find((row) => row.userId === other.user.id);
    expect(mine).toMatchObject({
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      quietHoursTimezone: "Europe/Berlin",
    });
    expect(theirs?.quietHoursStart).toBeNull();
    expect(
      evaluateQuietHours(
        {
          start: mine?.quietHoursStart ?? null,
          end: mine?.quietHoursEnd ?? null,
          timezone: mine?.quietHoursTimezone ?? null,
        },
        "UTC",
        new Date("2026-01-15T23:30:00Z"),
      ).kind,
    ).toBe("quiet");

    const cleared = await put(app, { quietHours: null });
    expect(cleared.status).toBe(200);
    expect(
      ((await cleared.json()) as { quietHours: unknown }).quietHours,
    ).toBeNull();
    const [row] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, mine?.id ?? ""));
    expect(row?.quietHoursStart).toBeNull();
    expect(row?.quietHoursTimezone).toBeNull();
  });

  it.each([
    [{ start: "25:00", end: "07:00", timezone: "UTC" }],
    [{ start: "22:00", end: "22:00", timezone: "UTC" }],
    [{ start: "22:00", end: "7:00", timezone: "UTC" }],
    [{ start: "22:00", end: "07:00", timezone: "Mars/Olympus" }],
    [{ start: "22:00", end: "07:00", timezone: "utc" }],
    [{ start: "22:00", end: "07:00", timezone: "+02:00" }],
    [{ start: "22:00", end: "07:00" }],
    [{ start: "22:00", end: "07:00", timezone: "UTC", extra: 1 }],
  ])("refuses an unusable window %j", async (window) => {
    const member = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await put(app, { quietHours: window });
    expect(response.status).toBe(400);
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id));
    expect(person?.quietHoursStart).toBeNull();
  });

  it("is saved on its own, not mixed with other preference fields", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const mixed = await put(app, {
      quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
      emailEnabled: false,
    });
    expect(mixed.status).toBe(400);
  });

  it("is refused for a customer-side session", async () => {
    const customer = await createCustomerPrincipal();
    await db
      .insert(schema.instanceSettingTable)
      .values({ id: "singleton", setupCompletedAt: new Date() })
      .onConflictDoNothing();
    mockAuthenticatedSession(customer.user);
    const { app } = createApp();
    const response = await put(app, {
      quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
    });
    expect([401, 403]).toContain(response.status);
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, customer.person.id));
    expect(person?.quietHoursStart).toBeNull();
  });
});
