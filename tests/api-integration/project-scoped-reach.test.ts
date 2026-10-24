/**
 * Project reach on every project-scoped route (#720, follow-up to #712).
 *
 * Every route below is declared `reach: "required"` on the `project` scope and the permission
 * matrix (`tests/permissions/matrix.fixture.json`) declares `404 not_found` for a caller
 * outside reach. Until #720 the write routes only checked workspace membership plus a legacy
 * workspace permission, so any workspace member with a strong role could change a project they
 * had no membership of. These tests drive the REAL middleware chain and assert, per route:
 *  - sessions: a same-workspace caller with no membership of the project (strong workspace
 *    roles, and a caller fully capable on ANOTHER project) gets the matrix's 404, writes
 *    nothing, sees no row, and gets byte-identical output to a request for a project that
 *    does not exist;
 *  - a caller who reaches the project but lacks the registered capability gets 403;
 *  - a project member holding the capability succeeds;
 *  - API keys: a key owned by someone outside reach gets the same 404, a read-scoped key owned
 *    by a capable member is refused (scope intersection is retained), a fully scoped key owned
 *    by a capable member succeeds.
 */
import { and, eq } from "drizzle-orm";
import { Client, type Notification } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { costTypeTable } from "../../apps/api/src/database/schema-p5-time";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { setTimeFlags } from "./helpers/p5-time";
import { ensureAgentSession } from "./helpers/pending-deletion";
import { projectKey } from "./helpers/project-key";
import {
  PROJECT_READ_ROUTE_KEYS,
  PROJECT_WRITE_ROUTE_KEYS,
} from "./helpers/project-reach-route-keys";
import {
  type Ids,
  missingIds,
  PROJECT_KEY_SCOPE,
  type ProjectWorld,
  projectSnapshot,
  READ_ONLY_KEY_SCOPE,
  seedProjectRows,
  setupProjectWorld,
} from "./helpers/project-reach-world";
import {
  type App,
  json,
  MATRIX,
  makeApiKey,
  matrixStatus,
  setAmbientHeaders,
} from "./helpers/reach-world";

type Case = {
  matrixKey: string;
  /** Put the data into the state this route's success path needs. */
  prepare?: (world: ProjectWorld, ids: Ids) => Promise<void>;
  successStatus?: number;
  /** Session-only route: every API key is refused with 403, outsiders included. */
  apiKeyRefused?: boolean;
  call: (app: App, world: ProjectWorld, ids: Ids) => Promise<Response>;
};

const SECRET_MARKERS = [
  "Confidential milestone",
  "Confidential prerequisite",
  "Confidential link",
  "Confidential legacy task",
  "Integration Project",
];

const WRITES: Case[] = [
  {
    matrixKey: "PUT /api/project/{id}",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/project/${i.projectId}`, {
        name: "Renamed",
        icon: "Folder",
        slug: projectKey(),
        description: "changed",
      }),
  },
  {
    matrixKey: "PATCH /api/project/{id}/health",
    call: (app, _w, i) =>
      json(app, "PATCH", `/api/project/${i.projectId}/health`, {
        health: "red",
      }),
  },
  {
    matrixKey: "DELETE /api/project/{id}",
    successStatus: 202,
    apiKeyRefused: true,
    call: (app, _w, i) => json(app, "DELETE", `/api/project/${i.projectId}`),
  },
  {
    matrixKey: "PUT /api/project/{id}/archive",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/project/${i.projectId}/archive`),
  },
  {
    matrixKey: "PUT /api/project/{id}/unarchive",
    prepare: async (_w, i) => {
      await db
        .update(schema.projectTable)
        .set({ archivedAt: new Date() })
        .where(eq(schema.projectTable.id, i.projectId));
    },
    call: (app, _w, i) =>
      json(app, "PUT", `/api/project/${i.projectId}/unarchive`),
  },
  {
    matrixKey: "POST /api/project/{id}/milestones",
    call: (app, _w, i) =>
      json(app, "POST", `/api/project/${i.projectId}/milestones`, {
        name: "Injected milestone",
        date: "2031-01-01T00:00:00.000Z",
      }),
  },
  {
    matrixKey: "PATCH /api/project/{id}/milestones/{milestoneId}",
    call: (app, _w, i) =>
      json(
        app,
        "PATCH",
        `/api/project/${i.projectId}/milestones/${i.milestoneId}`,
        { name: "Overwritten milestone" },
      ),
  },
  {
    matrixKey: "DELETE /api/project/{id}/milestones/{milestoneId}",
    successStatus: 202,
    call: (app, _w, i) =>
      json(
        app,
        "DELETE",
        `/api/project/${i.projectId}/milestones/${i.milestoneId}`,
      ),
  },
  {
    matrixKey: "POST /api/project/{id}/prerequisites",
    call: (app, _w, i) =>
      json(app, "POST", `/api/project/${i.projectId}/prerequisites`, {
        title: "Injected prerequisite",
        ownerSide: "us",
      }),
  },
  {
    matrixKey: "PATCH /api/project/{id}/prerequisites/{prerequisiteId}",
    call: (app, _w, i) =>
      json(
        app,
        "PATCH",
        `/api/project/${i.projectId}/prerequisites/${i.prerequisiteId}`,
        { title: "Overwritten prerequisite" },
      ),
  },
  {
    matrixKey: "DELETE /api/project/{id}/prerequisites/{prerequisiteId}",
    successStatus: 202,
    call: (app, _w, i) =>
      json(
        app,
        "DELETE",
        `/api/project/${i.projectId}/prerequisites/${i.prerequisiteId}`,
      ),
  },
  {
    matrixKey: "POST /api/project/{id}/stakeholders",
    call: (app, w, i) =>
      json(app, "POST", `/api/project/${i.projectId}/stakeholders`, {
        personId: w.readerLead.personId,
        role: "observer",
        escalationOrder: 2,
      }),
  },
  {
    matrixKey: "PATCH /api/project/{id}/stakeholders/{stakeholderId}",
    call: (app, _w, i) =>
      json(
        app,
        "PATCH",
        `/api/project/${i.projectId}/stakeholders/${i.stakeholderId}`,
        { role: "overwritten" },
      ),
  },
  {
    matrixKey: "POST /api/project/{id}/stakeholders/{stakeholderId}/stand-down",
    call: (app, _w, i) =>
      json(
        app,
        "POST",
        `/api/project/${i.projectId}/stakeholders/${i.stakeholderId}/stand-down`,
      ),
  },
  {
    matrixKey: "POST /api/project/{id}/document-links",
    call: (app, _w, i) =>
      json(app, "POST", `/api/project/${i.projectId}/document-links`, {
        url: "https://example.com/injected",
        title: "Injected link",
      }),
  },
  {
    matrixKey: "DELETE /api/project/{id}/document-links/{documentLinkId}",
    successStatus: 202,
    call: (app, _w, i) =>
      json(
        app,
        "DELETE",
        `/api/project/${i.projectId}/document-links/${i.documentLinkId}`,
      ),
  },
  {
    matrixKey: "POST /api/projects/{projectId}/work-items",
    call: (app, w, i) =>
      json(app, "POST", `/api/projects/${i.projectId}/work-items`, {
        typeId: w.type.id,
        title: "Injected work item",
      }),
  },
  {
    // PR-1: clearing a root project's parent is a no-op write, so the success path needs no
    // extra fixture; the prospective-parent capability check is covered in
    // project-ownership.test.ts.
    matrixKey: "PATCH /api/projects/{projectId}/ownership",
    call: (app, _w, i) =>
      json(app, "PATCH", `/api/projects/${i.projectId}/ownership`, {
        parentId: null,
      }),
  },
  {
    // PR-2..PR-4 roster writes. Each success call passes reach and capability and is then
    // refused by the handler with a status distinct from the matrix's 404/403 (unknown role
    // 422, a row held only by a role grant 409 managed_membership), proving the gates ran
    // before any write.
    matrixKey: "POST /api/projects/{projectId}/members",
    successStatus: 422,
    call: (app, w, i) =>
      json(app, "POST", `/api/projects/${i.projectId}/members`, {
        personId: w.readerAdmin.personId,
        roleKey: "no-such-role",
      }),
  },
  {
    matrixKey: "PATCH /api/projects/{projectId}/members/{personId}",
    successStatus: 422,
    call: (app, w, i) =>
      json(
        app,
        "PATCH",
        `/api/projects/${i.projectId}/members/${w.projectAdmin.personId}`,
        { roleKey: "no-such-role" },
      ),
  },
  {
    matrixKey: "DELETE /api/projects/{projectId}/members/{personId}",
    successStatus: 409,
    call: (app, w, i) =>
      json(
        app,
        "DELETE",
        `/api/projects/${i.projectId}/members/${w.readerAdmin.personId}`,
      ),
  },
  {
    // PR-17: an unknown template id passes reach and capability and is then refused by the
    // handler with 422 (a distinct status from the matrix's 404/403), which is what proves
    // the gates ran before the write.
    matrixKey: "POST /api/projects/{projectId}/states",
    successStatus: 422,
    call: (app, _w, i) =>
      json(app, "POST", `/api/projects/${i.projectId}/states`, {
        stateTemplateId: "no-such-template",
      }),
  },
  {
    matrixKey: "PATCH /api/projects/{projectId}/states/{stateId}",
    call: async (app, _w, i) => {
      const [state] = await db
        .select({ id: schema.stateTable.id })
        .from(schema.stateTable)
        .where(eq(schema.stateTable.projectId, i.projectId))
        .limit(1);
      return json(
        app,
        "PATCH",
        `/api/projects/${i.projectId}/states/${state?.id ?? "missing"}`,
        { position: 0 },
      );
    },
  },
  {
    // ST-2: a flag override. `enabled: null` clears the project override, so the success path
    // changes nothing yet still passes through reach and `project:manage_settings`.
    matrixKey: "PATCH /api/projects/{projectId}/features",
    call: (app, _w, i) =>
      json(app, "PATCH", `/api/projects/${i.projectId}/features`, {
        changes: [{ key: "feature.automations", enabled: null }],
      }),
  },
  {
    // AM: `feature.automations` is off by default, so a caller that passes reach and
    // `project:manage_settings` is refused by the handler with 409 feature_disabled, a status
    // distinct from the matrix's 404/403, which is what proves the gates ran before any write.
    // `{key}` accepts the project id as well as its slug.
    matrixKey: "POST /api/projects/{key}/automations",
    successStatus: 409,
    call: async (app, w, i) => {
      const [role] = await db
        .select({ id: schema.roleTable.id })
        .from(schema.roleTable)
        .where(
          and(
            eq(schema.roleTable.scope, "workspace"),
            eq(schema.roleTable.workspaceId, w.workspaceId),
            eq(schema.roleTable.key, "member"),
          ),
        )
        .limit(1);
      return json(app, "POST", `/api/projects/${i.projectId}/automations`, {
        name: "Injected automation",
        trigger: "work_item.created",
        conditions: [],
        actions: [{ type: "set_priority", priority: "high" }],
        effectiveRoleId: role?.id ?? "missing-role",
      });
    },
  },
  {
    matrixKey: "POST /api/projects/{projectId}/budgets",
    prepare: async (w) => {
      await setTimeFlags(w.workspaceId);
    },
    successStatus: 201,
    call: (app, _w, i) =>
      json(app, "POST", `/api/projects/${i.projectId}/budgets`, {
        name: "Q4",
        plannedAmountMinor: 100000,
        currency: "EUR",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      }),
  },
  {
    // P5 time and cost (`TC-14`): a cost entry needs an active cost type and feature.cost_tracking.
    matrixKey: "POST /api/projects/{projectId}/costs",
    prepare: async (w) => {
      await setTimeFlags(w.workspaceId);
      await db
        .insert(costTypeTable)
        .values({
          id: "ct-reach-row",
          workspaceId: w.workspaceId,
          name: "Licence",
          unit: "seat",
          defaultRateMinor: 100,
          currency: "EUR",
        })
        .onConflictDoNothing();
    },
    successStatus: 201,
    call: (app, _w, i) =>
      json(app, "POST", `/api/projects/${i.projectId}/costs`, {
        costTypeId: "ct-reach-row",
        date: new Date().toISOString().slice(0, 10),
        units: 1,
      }),
  },
  {
    matrixKey: "POST /api/task/{projectId}",
    call: (app, _w, i) =>
      json(app, "POST", `/api/task/${i.projectId}`, {
        title: "Injected legacy task",
        description: "d",
        priority: "medium",
        status: "to-do",
      }),
  },
  {
    matrixKey: "POST /api/task/import/{projectId}",
    call: (app, _w, i) =>
      json(app, "POST", `/api/task/import/${i.projectId}`, {
        tasks: [{ title: "Injected imported task", status: "to-do" }],
      }),
  },
  {
    matrixKey: "POST /api/column/{projectId}",
    call: (app, _w, i) =>
      json(app, "POST", `/api/column/${i.projectId}`, {
        name: "Injected column",
      }),
  },
  {
    matrixKey: "PUT /api/column/reorder/{projectId}",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/column/reorder/${i.projectId}`, {
        columns: [{ id: i.columnId, position: 9 }],
      }),
  },
  {
    matrixKey: "PUT /api/column/{id}",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/column/${i.columnId}`, {
        name: "Overwritten column",
      }),
  },
  {
    matrixKey: "DELETE /api/column/{id}",
    successStatus: 202,
    prepare: async (_w, i) => {
      // A column holding no task, so the delete's own preconditions pass.
      await db.delete(schema.workflowRuleTable);
      await db
        .delete(schema.taskTable)
        .where(eq(schema.taskTable.columnId, i.columnId));
    },
    call: (app, _w, i) => json(app, "DELETE", `/api/column/${i.columnId}`),
  },
  {
    matrixKey: "PUT /api/workflow-rule/{projectId}",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/workflow-rule/${i.projectId}`, {
        integrationType: "github",
        eventType: "pull_request_merged",
        columnId: i.columnId,
      }),
  },
  {
    matrixKey: "DELETE /api/workflow-rule/{id}",
    // Browser session only: a workflow rule is a column-routing setting, not history.
    apiKeyRefused: true,
    call: (app, _w, i) => json(app, "DELETE", `/api/workflow-rule/${i.ruleId}`),
  },
];

const READS: Case[] = [
  {
    matrixKey: "GET /api/project/{id}",
    call: (a, _w, i) => json(a, "GET", `/api/project/${i.projectId}`),
  },
  {
    matrixKey: "GET /api/project/{id}/health",
    call: (a, _w, i) => json(a, "GET", `/api/project/${i.projectId}/health`),
  },
  {
    matrixKey: "GET /api/project/{id}/milestones",
    call: (a, _w, i) =>
      json(a, "GET", `/api/project/${i.projectId}/milestones`),
  },
  {
    matrixKey: "GET /api/project/{id}/prerequisites",
    call: (a, _w, i) =>
      json(a, "GET", `/api/project/${i.projectId}/prerequisites`),
  },
  {
    matrixKey: "GET /api/project/{id}/stakeholders",
    call: (a, _w, i) =>
      json(a, "GET", `/api/project/${i.projectId}/stakeholders`),
  },
  {
    matrixKey: "GET /api/project/{id}/document-links",
    call: (a, _w, i) =>
      json(a, "GET", `/api/project/${i.projectId}/document-links`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/assignable",
    call: (a, _w, i) =>
      json(a, "GET", `/api/projects/${i.projectId}/assignable`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/states",
    call: (a, _w, i) => json(a, "GET", `/api/projects/${i.projectId}/states`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/state-templates",
    call: (a, _w, i) =>
      json(a, "GET", `/api/projects/${i.projectId}/state-templates`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/members",
    call: (a, _w, i) => json(a, "GET", `/api/projects/${i.projectId}/members`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/members/candidates",
    call: (a, _w, i) =>
      json(a, "GET", `/api/projects/${i.projectId}/members/candidates`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/ownership/preview",
    call: (a, _w, i) =>
      json(a, "GET", `/api/projects/${i.projectId}/ownership/preview`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/features",
    call: (a, _w, i) => json(a, "GET", `/api/projects/${i.projectId}/features`),
  },
  {
    matrixKey: "GET /api/projects/{key}/automations",
    call: (a, _w, i) =>
      json(a, "GET", `/api/projects/${i.projectId}/automations`),
  },
  {
    // P5 time and cost (`TC-15`): budgets need feature.cost_tracking, so the success path turns it on.
    matrixKey: "GET /api/projects/{projectId}/budget",
    prepare: async (w) => {
      await setTimeFlags(w.workspaceId);
    },
    call: (a, _w, i) => json(a, "GET", `/api/projects/${i.projectId}/budget`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/costs",
    prepare: async (w) => {
      await setTimeFlags(w.workspaceId);
    },
    call: (a, _w, i) => json(a, "GET", `/api/projects/${i.projectId}/costs`),
  },
  {
    matrixKey: "GET /api/features/resolved",
    call: (a, _w, i) =>
      json(a, "GET", `/api/features/resolved?project=${i.projectId}`),
  },
  {
    matrixKey: "GET /api/projects/{projectId}/work-items",
    call: (a, _w, i) =>
      json(a, "GET", `/api/projects/${i.projectId}/work-items`),
  },
  {
    matrixKey: "GET /api/task/tasks/{projectId}",
    call: (a, _w, i) => json(a, "GET", `/api/task/tasks/${i.projectId}`),
  },
  {
    matrixKey: "GET /api/task/export/{projectId}",
    call: (a, _w, i) => json(a, "GET", `/api/task/export/${i.projectId}`),
  },
  {
    matrixKey: "GET /api/column/{projectId}",
    call: (a, _w, i) => json(a, "GET", `/api/column/${i.projectId}`),
  },
  {
    matrixKey: "GET /api/workflow-rule/{projectId}",
    call: (a, _w, i) => json(a, "GET", `/api/workflow-rule/${i.projectId}`),
  },
];

describe("API integration: project reach on project-scoped routes (#720)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  it("the tables cover exactly the routes the guard requires", () => {
    expect(WRITES.map((route) => route.matrixKey).sort()).toEqual(
      [...PROJECT_WRITE_ROUTE_KEYS].sort(),
    );
    expect(READS.map((route) => route.matrixKey).sort()).toEqual(
      [...PROJECT_READ_ROUTE_KEYS].sort(),
    );
  });

  const ADVISORY_CLASS = 580840;
  const ADVISORY_OBJECT = 842;
  const PROBE_TRIGGER = "zz_session840_fixture_completion_gate";
  const PROBE_FUNCTION = "session840_fixture_completion_gate";
  const PROBE_CHANNEL = "session840_fixture_completion";

  function sqlLiteral(value: string) {
    return "'" + value.replaceAll("'", "''") + "'";
  }

  function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((resolvePromise) => {
      resolve = resolvePromise;
    });
    return { promise, resolve };
  }

  async function waitForSignal<T>(signal: Promise<T>, description: string) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        signal,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Timed out waiting for " + description)),
            5_000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function waitForCondition<T>(
    condition: () => Promise<T | undefined>,
    description: string,
  ) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const result = await condition();
      if (result !== undefined) return result;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Timed out observing " + description);
  }

  it("waits for its actual created activity before returning from the fixture", async () => {
    const control = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const observer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const listener = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const connected = new Set<Client>();
    let gateHeld = false;
    let triggerInstalled = false;
    let functionInstalled = false;
    let seedPromise: ReturnType<typeof seedProjectRows> | undefined;
    let seedSettled = false;
    let activityCommitted = false;
    const activityNotification = deferred<Notification>();
    listener.on("notification", (notification) => {
      if (notification.channel === PROBE_CHANNEL) {
        activityCommitted = true;
        activityNotification.resolve(notification);
      }
    });

    const cleanupFailures: string[] = [];
    let probeFailed = false;
    let probeError: unknown;

    try {
      for (const client of [control, observer, listener]) {
        await client.connect();
        connected.add(client);
      }
      await listener.query("LISTEN " + PROBE_CHANNEL);

      // Build all fixture rows before installing the narrowly scoped activity gate.
      const world = await setupProjectWorld();
      const app = createApp().app;
      const projectLiteral = sqlLiteral(world.project.id);
      const actorLiteral = sqlLiteral(world.projectAdmin.user.id);

      const existing = await control.query(
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.task_activity'::regclass AND tgname = $1) AS trigger_exists, " +
          "to_regprocedure('public." +
          PROBE_FUNCTION +
          "()') IS NOT NULL AS function_exists",
        [PROBE_TRIGGER],
      );
      expect(existing.rows[0]).toEqual({
        trigger_exists: false,
        function_exists: false,
      });

      const controlPidResult = await control.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const controlPid = controlPidResult.rows[0]?.pid;
      if (controlPid === undefined)
        throw new Error("expected owned control backend pid");

      await control.query("SELECT pg_advisory_lock($1, $2)", [
        ADVISORY_CLASS,
        ADVISORY_OBJECT,
      ]);
      gateHeld = true;
      await control.query(
        [
          "CREATE FUNCTION public." + PROBE_FUNCTION + "() RETURNS trigger",
          "LANGUAGE plpgsql AS $$",
          "BEGIN",
          "  IF NEW.type = 'created' AND NEW.user_id::text = " + actorLiteral,
          "     AND EXISTS (",
          "       SELECT 1 FROM public.task AS target_task",
          "       WHERE target_task.id = NEW.task_id",
          "         AND target_task.project_id::text = " + projectLiteral,
          "     ) THEN",
          "    PERFORM pg_advisory_xact_lock(" +
            ADVISORY_CLASS +
            ", " +
            ADVISORY_OBJECT +
            ");",
          "    PERFORM pg_notify('" + PROBE_CHANNEL + "', NEW.id);",
          "  END IF;",
          "  RETURN NEW;",
          "END;",
          "$$;",
        ].join("\n"),
      );
      functionInstalled = true;
      await control.query(
        "CREATE TRIGGER " +
          PROBE_TRIGGER +
          " AFTER INSERT ON public.task_activity FOR EACH ROW EXECUTE FUNCTION public." +
          PROBE_FUNCTION +
          "()",
      );
      triggerInstalled = true;

      const triggerOrder = await control.query(
        "SELECT t.tgname AS trigger_name, " +
          "coalesce(c.contype = 'f' AND c.conrelid = 'public.task_activity'::regclass " +
          "AND c.confrelid = 'public.task'::regclass, false) AS is_task_fk, " +
          "t.tgdeferrable AS deferrable, t.tginitdeferred AS initially_deferred, " +
          "t.tgenabled AS enabled FROM pg_trigger t LEFT JOIN pg_constraint c ON c.oid = t.tgconstraint " +
          "WHERE t.tgrelid = 'public.task_activity'::regclass AND (t.tgtype & 1) = 1 " +
          "AND (t.tgtype & 2) = 0 AND (t.tgtype & 4) = 4 ORDER BY t.tgname::text COLLATE " +
          '"C"',
      );
      const names = triggerOrder.rows.map((row) => row.trigger_name);
      const gateIndex = names.indexOf(PROBE_TRIGGER);
      const fkIndexes = triggerOrder.rows.flatMap((row, index) =>
        row.is_task_fk ? [index] : [],
      );
      expect(gateIndex).toBeGreaterThan(-1);
      expect(fkIndexes.length).toBeGreaterThan(0);
      expect(Math.max(...fkIndexes)).toBeLessThan(gateIndex);
      expect(
        triggerOrder.rows
          .filter((row) => row.is_task_fk)
          .every((row) => !row.deferrable && !row.initially_deferred),
      ).toBe(true);
      expect(
        triggerOrder.rows.find((row) => row.trigger_name === PROBE_TRIGGER)
          ?.enabled,
      ).not.toBe("D");

      const taskResponseJson = deferred<void>();
      const observedApp = new Proxy(app, {
        get(target, property, receiver) {
          if (property !== "request")
            return Reflect.get(target, property, receiver);
          return async (...args: Parameters<App["request"]>) => {
            const response = await target.request(...args);
            if (String(args[0]) === "/api/task/" + world.project.id) {
              const parseJson = response.json.bind(response);
              response.json = async () => {
                const body = await parseJson();
                taskResponseJson.resolve();
                return body;
              };
            }
            return response;
          };
        },
      });
      seedPromise = seedProjectRows(observedApp, world);
      seedPromise.then(
        () => {
          seedSettled = true;
        },
        () => {
          seedSettled = true;
        },
      );
      const waitingActivity = await waitForCondition(async () => {
        const result = await observer.query(
          "SELECT a.pid, a.wait_event_type, a.wait_event, pg_blocking_pids(a.pid) AS blockers, " +
            "EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid AND l.relation = 'public.task'::regclass " +
            "AND l.mode = 'RowShareLock' AND l.granted) AS task_fk_lock, " +
            "EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid " +
            "AND l.relation = 'public.task_activity'::regclass AND l.mode = 'RowExclusiveLock' " +
            "AND l.granted) AS activity_insert_lock, " +
            "coalesce(a.query ~* '^INSERT[[:space:]]+INTO[[:space:]]+\"?task_activity\"?', false) " +
            "AS created_activity_insert FROM pg_stat_activity a JOIN pg_locks gate ON gate.pid = a.pid " +
            "AND gate.locktype = 'advisory' AND gate.classid = " +
            ADVISORY_CLASS +
            "::oid AND gate.objid = " +
            ADVISORY_OBJECT +
            "::oid AND gate.objsubid = 2 AND NOT gate.granted " +
            "WHERE a.datname = current_database() LIMIT 8",
        );
        return result.rows.find(
          (row) =>
            row.wait_event_type === "Lock" && row.wait_event === "advisory",
        );
      }, "the actual created-activity INSERT at the owned advisory gate");
      expect(waitingActivity.blockers).toContain(controlPid);
      expect(waitingActivity.task_fk_lock).toBe(true);
      expect(waitingActivity.activity_insert_lock).toBe(true);
      expect(waitingActivity.created_activity_insert).toBe(true);
      await waitForSignal(
        taskResponseJson.promise,
        "actual POST task response JSON completion",
      );
      // Drain promise continuations after the real response body is decoded. With the old
      // helper this makes its immediate return observable; with the proposed helper the
      // created-activity row is still held at the owned gate.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(seedSettled).toBe(false);

      const unlock = await control.query("SELECT pg_advisory_unlock($1, $2)", [
        ADVISORY_CLASS,
        ADVISORY_OBJECT,
      ]);
      expect(unlock.rows[0]?.pg_advisory_unlock).toBe(true);
      gateHeld = false;

      const ids = await waitForSignal(
        seedPromise,
        "seedProjectRows after its created activity commits",
      );
      expect(ids.taskId).toBeTruthy();
      const notification = await waitForSignal(
        activityNotification.promise,
        "actual created-activity commit after gate release",
      );
      expect(notification.payload).toBeTruthy();
      const activity = await db.query.taskActivityTable.findFirst({
        where: and(
          eq(schema.taskActivityTable.id, notification.payload ?? ""),
          eq(schema.taskActivityTable.taskId, ids.taskId),
          eq(schema.taskActivityTable.type, "created"),
          eq(schema.taskActivityTable.userId, world.projectAdmin.user.id),
        ),
      });
      expect(activity).toBeDefined();

      await resetTestDatabase();
      expect(
        await db.query.taskTable.findFirst({
          where: eq(schema.taskTable.id, ids.taskId),
        }),
      ).toBeUndefined();
      expect(
        await db.query.taskActivityTable.findFirst({
          where: eq(schema.taskActivityTable.id, notification.payload ?? ""),
        }),
      ).toBeUndefined();
    } catch (error) {
      probeFailed = true;
      probeError = error;
    } finally {
      if (gateHeld && connected.has(control)) {
        try {
          const unlocked = await control.query(
            "SELECT pg_advisory_unlock($1, $2)",
            [ADVISORY_CLASS, ADVISORY_OBJECT],
          );
          if (!unlocked.rows[0]?.pg_advisory_unlock) {
            cleanupFailures.push(
              "owned advisory key was not held during cleanup",
            );
          } else {
            gateHeld = false;
          }
        } catch {
          cleanupFailures.push("could not release the owned advisory gate");
        }
      }
      if (seedPromise) {
        try {
          await waitForSignal(
            seedPromise,
            "seedProjectRows cleanup completion",
          );
        } catch {
          cleanupFailures.push(
            "seedProjectRows did not resolve during cleanup",
          );
        }
      }
      if (triggerInstalled && !activityCommitted) {
        try {
          await waitForSignal(
            activityNotification.promise,
            "created-activity cleanup commit",
          );
        } catch {
          cleanupFailures.push(
            "the actual created activity did not commit during cleanup",
          );
        }
      }
      if (triggerInstalled && connected.has(control)) {
        try {
          await control.query(
            "DROP TRIGGER IF EXISTS " +
              PROBE_TRIGGER +
              " ON public.task_activity",
          );
          triggerInstalled = false;
        } catch {
          cleanupFailures.push("could not drop the owned trigger");
        }
      }
      if (functionInstalled && connected.has(control)) {
        try {
          await control.query(
            "DROP FUNCTION IF EXISTS public." + PROBE_FUNCTION + "()",
          );
          functionInstalled = false;
        } catch {
          cleanupFailures.push("could not drop the owned trigger function");
        }
      }
      if (connected.has(listener)) {
        try {
          await listener.query("UNLISTEN " + PROBE_CHANNEL);
        } catch {
          cleanupFailures.push(
            "could not clear the owned notification listener",
          );
        }
      }
      const closes = await Promise.allSettled(
        [...connected].map(async (client) => {
          await client.end();
        }),
      );
      if (closes.some((result) => result.status === "rejected")) {
        cleanupFailures.push(
          "one or more owned PostgreSQL clients did not close",
        );
      }
    }

    const cleanupError =
      cleanupFailures.length > 0
        ? new Error(
            "Controlled fixture probe cleanup incomplete (" +
              cleanupFailures.length +
              " issue(s)): " +
              cleanupFailures.join("; "),
          )
        : undefined;
    if (probeFailed && cleanupError) {
      throw new AggregateError(
        [probeError, cleanupError],
        "Controlled fixture probe failed and cleanup was incomplete",
      );
    }
    if (probeFailed) {
      throw probeError;
    }
    if (cleanupError) {
      throw cleanupError;
    }
  }, 20_000);

  async function arrange(route: Case) {
    const world = await setupProjectWorld();
    const { app } = createApp();
    const ids = await seedProjectRows(app, world);
    await route.prepare?.(world, ids);
    // Deletion routes record pending actions bound to the caller's live session row.
    await ensureAgentSession(world.projectAdmin.user.id);
    return { world, app, ids };
  }

  function outsiders(world: ProjectWorld) {
    return [
      world.outsiderLead,
      world.outsiderMember,
      world.outsiderAdmin,
      // Fully capable on ANOTHER project of the same workspace: not reach to this one.
      world.otherProjectAdmin,
    ];
  }

  for (const route of [...WRITES, ...READS]) {
    const isRead = route.matrixKey.startsWith("GET ");
    describe(route.matrixKey, () => {
      it("a same-workspace caller outside project reach gets the matrix's 404 byte-identical to a missing project, and writes nothing", async () => {
        const { world, app, ids } = await arrange(route);
        const declared = matrixStatus(
          MATRIX.routes[route.matrixKey]?.member?.outOfReach,
        );
        expect(declared).toBe(404);
        const before = await projectSnapshot();

        mockAuthenticatedSession(world.projectAdmin.user);
        const missing = await route.call(app, world, missingIds());
        const missingText = await missing.text();
        expect(missing.status, missingText).toBe(404);

        for (const outsider of outsiders(world)) {
          mockAuthenticatedSession(outsider.user);
          const response = await route.call(app, world, ids);
          const text = await response.text();
          expect(response.status, text).toBe(declared);
          expect(text).toBe(missingText);
          for (const marker of SECRET_MARKERS) {
            expect(text).not.toContain(marker);
          }
        }
        expect(await projectSnapshot()).toBe(before);
      });

      if (!isRead) {
        it("a caller who reaches the project without the capability gets 403 and nothing is written", async () => {
          const { world, app, ids } = await arrange(route);
          expect(
            matrixStatus(MATRIX.routes[route.matrixKey]?.viewer?.inReach),
          ).toBe(403);
          const before = await projectSnapshot();
          mockAuthenticatedSession(world.readerLead.user);
          const response = await route.call(app, world, ids);
          const text = await response.text();
          expect(response.status, text).toBe(403);
          expect(await projectSnapshot()).toBe(before);
        });
      }

      it("a project member holding the capability succeeds", async () => {
        const { world, app, ids } = await arrange(route);
        mockAuthenticatedSession(world.projectAdmin.user);
        const response = await route.call(app, world, ids);
        expect(response.status, await response.clone().text()).toBe(
          route.successStatus ?? 200,
        );
      });

      it("API keys: an outsider's key gets the same 404; on writes a read-scoped key is refused and a scoped key of a capable member succeeds", async () => {
        const { world, app, ids } = await arrange(route);
        mockAnonymousSession();
        const outsiderKey = await makeApiKey(
          world.outsiderAdmin.user.id,
          PROJECT_KEY_SCOPE,
        );
        const memberKey = await makeApiKey(
          world.projectAdmin.user.id,
          PROJECT_KEY_SCOPE,
        );
        const readKey = await makeApiKey(
          world.projectAdmin.user.id,
          READ_ONLY_KEY_SCOPE,
        );
        const before = await projectSnapshot();

        setAmbientHeaders({ "x-api-key": outsiderKey });
        const outside = await route.call(app, world, ids);
        const outsideText = await outside.text();
        // A session-only route refuses every key identically before reach is consulted.
        expect(outside.status, outsideText).toBe(
          route.apiKeyRefused ? 403 : 404,
        );
        for (const marker of SECRET_MARKERS) {
          expect(outsideText).not.toContain(marker);
        }
        expect(await projectSnapshot()).toBe(before);

        if (!isRead) {
          setAmbientHeaders({ "x-api-key": readKey });
          const scoped = await route.call(app, world, ids);
          const scopedText = await scoped.text();
          expect(scoped.status, scopedText).toBe(403);
          expect(await projectSnapshot()).toBe(before);
        }

        if (!isRead) {
          // Reads gate API keys on a canonical capability subset that keys do not carry
          // yet (`resolveIdentity`), a pre-existing behaviour this change does not touch;
          // writes defer that to the key-aware legacy gate, so a scoped key succeeds.
          setAmbientHeaders({ "x-api-key": memberKey });
          const allowed = await route.call(app, world, ids);
          setAmbientHeaders({});
          expect(allowed.status, await allowed.clone().text()).toBe(
            route.apiKeyRefused ? 403 : (route.successStatus ?? 200),
          );
          if (route.apiKeyRefused)
            expect(await allowed.text()).toContain("session_required");
        }
      });
    });
  }

  describe("PUT /api/project/{id}: reach is decided before the settings-capability check", () => {
    const body = (project: { slug: string }) => ({
      name: "Renamed",
      icon: "Folder",
      slug: project.slug,
      description: "changed",
      defaultCommentVisibility: "internal",
    });

    it("an outsider sending defaultCommentVisibility gets 404, never the 403 that would confirm the project exists", async () => {
      const world = await setupProjectWorld();
      const { app } = createApp();
      const before = await projectSnapshot();
      mockAuthenticatedSession(world.outsiderAdmin.user);
      const response = await json(
        app,
        "PUT",
        `/api/project/${world.project.id}`,
        body(world.project),
      );
      const text = await response.text();
      expect(response.status, text).toBe(404);
      expect(await projectSnapshot()).toBe(before);
    });
  });
});
