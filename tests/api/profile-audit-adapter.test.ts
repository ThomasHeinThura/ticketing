import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  rows: new Map<
    string,
    { name: string; locale: string | null; image: string | null }
  >(),
  audits: [] as Record<string, unknown>[],
  failAudit: false,
  transactionCount: 0,
  personSide: "staff" as "staff" | "customer",
  events: [] as string[],
  signals: [] as string[],
  notifications: [] as string[],
  failNotification: false,
}));

vi.mock("../../apps/api/src/database", async (original) => {
  const actual = await original<typeof import("../../apps/api/src/database")>();
  const cloneRows = (rows: typeof fixture.rows) =>
    new Map([...rows.entries()].map(([id, row]) => [id, { ...row }] as const));
  const select = (
    rows: typeof fixture.rows,
    fields: Record<string, unknown>,
  ) => ({
    from: () => ({
      where: () => ({
        for: async () => {
          fixture.events.push("lock");
          return [...rows.entries()].map(([id, row]) =>
            "name" in fields
              ? { ...row }
              : { id, side: fixture.personSide, active: true },
          );
        },
        limit: async () =>
          "name" in fields
            ? [...rows.values()].map((row) => ({ ...row }))
            : [{ id: "person-1", side: fixture.personSide, active: true }],
      }),
    }),
  });
  const createTx = (
    rows: typeof fixture.rows,
    auditRows: Record<string, unknown>[],
  ): object => ({
    auditRows,
    select: (fields: Record<string, unknown>) => select(rows, fields),
    update: () => ({
      set: (update: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            fixture.events.push("update");
            const before = rows.get("user-1");
            if (!before) return [];
            const after = { ...before, ...update };
            rows.set("user-1", after);
            return [{ id: "user-1", ...after }];
          },
        }),
      }),
    }),
    transaction: async (nested: (tx: object) => Promise<unknown>) => {
      const childRows = cloneRows(rows);
      const childAuditRows: Record<string, unknown>[] = [];
      const result = await nested(createTx(childRows, childAuditRows));
      rows.clear();
      for (const [id, row] of childRows) rows.set(id, row);
      auditRows.push(...childAuditRows);
      return result;
    },
  });
  const database = {
    transaction: async (callback: (tx: object) => Promise<unknown>) => {
      fixture.transactionCount++;
      const pending = cloneRows(fixture.rows);
      const pendingAuditRows: Record<string, unknown>[] = [];
      const result = await callback(createTx(pending, pendingAuditRows));
      fixture.rows = pending;
      fixture.audits.push(...pendingAuditRows);
      return result;
    },
  };
  return { ...actual, default: database };
});

vi.mock("../../apps/api/src/audit/audit-writer", () => ({
  appendAuditLog: async (
    tx: { auditRows: Record<string, unknown>[] },
    entry: Record<string, unknown>,
  ) => {
    if (fixture.failAudit) throw new Error("audit failed");
    fixture.events.push("audit");
    tx.auditRows.push(entry);
  },
}));
vi.mock("../../apps/api/src/instance/observability/runtime", () => ({
  recordAuditWriteFailure: (operation: string) =>
    fixture.signals.push(operation),
}));
vi.mock(
  "../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({
    notifyCurrentInstanceAdminsOfAuditFailure: async (operation: string) => {
      fixture.notifications.push(operation);
      if (fixture.failNotification) throw new Error("notification unavailable");
    },
  }),
);

import {
  authorizeSelfProfileMutation,
  createCredentialAwareDrizzleAdapter,
  withSelfProfileMutation,
} from "../../apps/api/src/pending-action/credential-invalidation";

const actor = {
  userId: "user-1",
  portal: "agent" as const,
  actorIp: null,
  userAgent: null,
  traceId: "trace-1",
};
const input = (update: Record<string, unknown>) => ({
  model: "user",
  where: [{ field: "id", value: "user-1" }],
  update,
});

beforeEach(() => {
  fixture.rows = new Map([
    ["user-1", { name: "Old", locale: null, image: null }],
  ]);
  fixture.audits = [];
  fixture.failAudit = false;
  fixture.transactionCount = 0;
  fixture.personSide = "staff";
  fixture.events = [];
  fixture.signals = [];
  fixture.notifications = [];
  fixture.failNotification = false;
});

describe("self-profile adapter audit", () => {
  it("commits only closed changed-field metadata with the actual user update", async () => {
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    await withSelfProfileMutation(actor, async () => {
      authorizeSelfProfileMutation("user-1", "agent");
      await adapter.update(input({ name: "New", image: "private-url" }));
    });
    expect(fixture.rows.get("user-1")?.name).toBe("New");
    expect(fixture.audits).toMatchObject([
      {
        action: "user.profile_updated",
        entityType: "user_profile",
        entityId: "person-1",
        actorId: "user-1",
        after: { changedFields: ["name", "image"] },
      },
    ]);
    expect(JSON.stringify(fixture.audits)).not.toContain("private-url");
    expect(fixture.transactionCount).toBe(1);
    expect(fixture.events).toEqual(["lock", "update", "audit"]);
  });

  it("omits history for an effective no-op", async () => {
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    await withSelfProfileMutation(actor, async () => {
      authorizeSelfProfileMutation("user-1", "agent");
      await adapter.update(input({ name: "Old" }));
    });
    expect(fixture.audits).toEqual([]);
  });

  it("commits the edit and signals once after an isolated audit append failure", async () => {
    fixture.failAudit = true;
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    await withSelfProfileMutation(actor, async () => {
      authorizeSelfProfileMutation("user-1", "agent");
      await adapter.update(input({ name: "New" }));
    });
    expect(fixture.rows.get("user-1")?.name).toBe("New");
    expect(fixture.audits).toEqual([]);
    expect(fixture.signals).toEqual(["mutation"]);
    expect(fixture.notifications).toEqual(["mutation"]);
  });

  it("omits committed notification when the enclosing adapter transaction rolls back", async () => {
    fixture.failAudit = true;
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    await expect(
      withSelfProfileMutation(actor, async () => {
        authorizeSelfProfileMutation("user-1", "agent");
        await adapter.transaction(async (txAdapter) => {
          await txAdapter.update(input({ name: "New" }));
          throw new Error("outer rollback");
        });
      }),
    ).rejects.toThrow("outer rollback");
    expect(fixture.rows.get("user-1")?.name).toBe("Old");
    expect(fixture.audits).toEqual([]);
    expect(fixture.notifications).toEqual([]);
    expect(fixture.signals).toEqual(["mutation"]);
  });

  it("defers nested adapter audit-failure notifications until the outer commit", async () => {
    fixture.failAudit = true;
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    await expect(
      withSelfProfileMutation(actor, async () => {
        authorizeSelfProfileMutation("user-1", "agent");
        await adapter.transaction(async () => {
          await adapter.transaction(async (nested) => {
            await nested.update(input({ name: "New" }));
          });
          expect(fixture.notifications).toEqual([]);
          throw new Error("parent rollback");
        });
      }),
    ).rejects.toThrow("parent rollback");
    expect(fixture.rows.get("user-1")?.name).toBe("Old");
    expect(fixture.notifications).toEqual([]);
    expect(fixture.signals).toEqual(["mutation"]);
  });

  it("sends one notification after a successful nested adapter commit", async () => {
    fixture.failAudit = true;
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    await withSelfProfileMutation(actor, async () => {
      authorizeSelfProfileMutation("user-1", "agent");
      await adapter.transaction(async () => {
        await adapter.transaction(async (nested) => {
          await nested.update(input({ name: "New" }));
        });
        expect(fixture.notifications).toEqual([]);
      });
    });
    expect(fixture.rows.get("user-1")?.name).toBe("New");
    expect(fixture.notifications).toEqual(["mutation"]);
    expect(fixture.signals).toEqual(["mutation"]);
  });

  it("discards a failed child savepoint while preserving the parent's audit and notification", async () => {
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    await withSelfProfileMutation(actor, async () => {
      authorizeSelfProfileMutation("user-1", "agent");
      await adapter.transaction(async (outer) => {
        fixture.failAudit = true;
        await expect(
          adapter.transaction(async (child) => {
            await child.update(input({ name: "Child" }));
            throw new Error("child rollback");
          }),
        ).rejects.toThrow("child rollback");

        fixture.failAudit = false;
        await outer.update(input({ name: "Child" }));
        fixture.failAudit = true;
        await outer.update(input({ image: "private-parent-url" }));
        expect(fixture.notifications).toEqual([]);
      });
    });
    expect(fixture.rows.get("user-1")).toMatchObject({
      name: "Child",
      image: "private-parent-url",
    });
    expect(fixture.audits).toMatchObject([
      { after: { changedFields: ["name"] } },
    ]);
    expect(fixture.audits).toHaveLength(1);
    expect(JSON.stringify(fixture.audits)).not.toContain("private-parent-url");
    expect(fixture.signals).toEqual(["mutation", "mutation"]);
    expect(fixture.notifications).toEqual(["mutation"]);
  });

  it("discards an appended audit row when the enclosing mutation rolls back", async () => {
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    await expect(
      withSelfProfileMutation(actor, async () => {
        authorizeSelfProfileMutation("user-1", "agent");
        await adapter.transaction(async (txAdapter) => {
          await txAdapter.update(input({ name: "New" }));
          throw new Error("mutation rollback");
        });
      }),
    ).rejects.toThrow("mutation rollback");
    expect(fixture.rows.get("user-1")?.name).toBe("Old");
    expect(fixture.audits).toEqual([]);
    expect(fixture.notifications).toEqual([]);
    expect(fixture.signals).toEqual([]);
  });

  it("does not reject an already committed edit if notification fails", async () => {
    fixture.failAudit = true;
    fixture.failNotification = true;
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    await withSelfProfileMutation(actor, async () => {
      authorizeSelfProfileMutation("user-1", "agent");
      await adapter.update(input({ name: "New" }));
    });
    expect(fixture.rows.get("user-1")?.name).toBe("New");
    expect(fixture.signals).toEqual(["mutation"]);
    expect(fixture.notifications).toEqual(["mutation"]);
  });

  it("rejects a mismatched selector and keeps context request-scoped", async () => {
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    expect(() => authorizeSelfProfileMutation("user-1", "agent")).toThrow();
    await expect(
      withSelfProfileMutation(actor, async () => {
        authorizeSelfProfileMutation("user-1", "agent");
        await adapter.update({
          ...input({ name: "New" }),
          where: [{ field: "id", value: "user-2" }],
        });
      }),
    ).rejects.toThrow();
    expect(fixture.rows.get("user-1")?.name).toBe("Old");
    expect(fixture.audits).toEqual([]);
    expect(() => authorizeSelfProfileMutation("user-1", "agent")).toThrow();
  });

  it("rejects unapproved user fields and a mismatched authoritative portal", async () => {
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    await expect(
      withSelfProfileMutation(actor, async () => {
        authorizeSelfProfileMutation("user-1", "customer");
      }),
    ).rejects.toThrow();
    await expect(
      withSelfProfileMutation(actor, async () => {
        authorizeSelfProfileMutation("user-2", "agent");
      }),
    ).rejects.toThrow();
    await expect(
      withSelfProfileMutation(actor, async () => {
        authorizeSelfProfileMutation("user-1", "agent");
        await adapter.update(input({ role: "admin" }));
      }),
    ).rejects.toThrow("Unexpected self-profile update");
    expect(fixture.rows.get("user-1")?.name).toBe("Old");
    expect(fixture.transactionCount).toBe(0);
  });

  it("targets the caller's customer person on the portal side", async () => {
    fixture.personSide = "customer";
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    await withSelfProfileMutation(
      { ...actor, portal: "customer" },
      async () => {
        authorizeSelfProfileMutation("user-1", "customer");
        await adapter.update(input({ image: "private-portal-url" }));
      },
    );
    expect(fixture.audits).toMatchObject([
      { entityId: "person-1", after: { changedFields: ["image"] } },
    ]);
    expect(JSON.stringify(fixture.audits)).not.toContain("private-portal-url");
  });

  it("keeps simultaneous request contexts separate", async () => {
    const adapter = createCredentialAwareDrizzleAdapter()({} as never);
    let resumeFirst: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      resumeFirst = resolve;
    });
    const first = withSelfProfileMutation(actor, async () => {
      authorizeSelfProfileMutation("user-1", "agent");
      await wait;
      await adapter.update(input({ name: "New" }));
    });
    await withSelfProfileMutation(
      { ...actor, userId: "user-2", traceId: "trace-2" },
      async () => {
        authorizeSelfProfileMutation("user-2", "agent");
        resumeFirst();
      },
    );
    await first;
    expect(fixture.audits).toMatchObject([
      { actorId: "user-1", traceId: "trace-1" },
    ]);
  });

  it("uses the existing adapter transaction without opening another profile transaction", async () => {
    const adapter = createCredentialAwareDrizzleAdapter()({
      user: { additionalFields: { locale: { type: "string" } } },
    } as never);
    await withSelfProfileMutation(actor, async () => {
      authorizeSelfProfileMutation("user-1", "agent");
      await adapter.transaction(async (txAdapter) => {
        await txAdapter.update(input({ locale: "en-US" }));
      });
    });
    expect(fixture.rows.get("user-1")?.locale).toBe("en-US");
    expect(fixture.audits).toMatchObject([
      { after: { changedFields: ["locale"] } },
    ]);
    expect(fixture.transactionCount).toBe(1);
  });
});
