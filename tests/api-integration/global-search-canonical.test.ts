/**
 * SV-1..SV-9: canonical global search over `work_item`, people and saved views.
 *
 * NOTE: written by the P1 search implementer WITHOUT a database; the coordinator runs it.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { searchCanonicalWorkItems } from "../../apps/api/src/search/canonical-repository";
import { escapeLikePattern } from "../../apps/api/src/search/like-pattern";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";
import { addMember } from "./helpers/reach-world";
import { ensureCreationWorkflow } from "./helpers/workflow";

type Result = {
  id: string;
  type: string;
  title: string;
  key?: string;
  relevanceScore: number;
};

async function seedWorld() {
  const member = await createWorkspaceMember({ role: "member" });
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantProjectRole(member.user.id, project.id, [
    "work_item:read",
    "work_item:create",
    "project:read",
    "workspace:read",
  ]);
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId: member.workspace.id,
      key: `type-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const [template] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId: member.workspace.id,
      key: `state-${randomUUID()}`,
      name: "Started",
      group: "started",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type || !template) throw new Error("fixture failed");
  await db.insert(schema.stateTable).values({
    projectId: project.id,
    stateTemplateId: template.id,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
  await ensureCreationWorkflow({
    workspaceId: member.workspace.id,
    projectId: project.id,
    typeId: type.id,
  });
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  const create = async (title: string) => {
    const response = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typeId: type.id, title }),
      },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { id: string; key: string };
  };
  const search = async (q: string, extra = "") => {
    const response = await app.request(
      `/api/search?q=${encodeURIComponent(q)}&workspaceId=${member.workspace.id}${extra}`,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { results: Result[] }).results;
  };
  return { member, project, type, template, app, create, search };
}

/**
 * A project with a default state and creation workflow, so work items can be created in it.
 * A type keeps ONE workflow, so a second project that shares the type must default to a state
 * template that workflow can leave: pass the first project's `sharedStateTemplateId`.
 */
async function provisionProject(
  workspaceId: string,
  projectId: string,
  typeId: string,
  sharedStateTemplateId?: string,
) {
  const now = new Date();
  const [template] = sharedStateTemplateId
    ? [{ id: sharedStateTemplateId }]
    : await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId,
          key: `state-${randomUUID()}`,
          name: "Started",
          group: "started",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
  if (!template) throw new Error("state template fixture failed");
  await db.insert(schema.stateTable).values({
    projectId,
    stateTemplateId: template.id,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
  await ensureCreationWorkflow({ workspaceId, projectId, typeId });
}

async function createItemAs(
  app: ReturnType<typeof createApp>["app"],
  user: Parameters<typeof mockAuthenticatedSession>[0],
  projectId: string,
  typeId: string,
  title: string,
) {
  mockAuthenticatedSession(user);
  const response = await app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId, title }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { id: string; key: string };
}

/** The pre-branch search query, retained as a test oracle for semantic parity. */
async function searchCanonicalWorkItemsBaseline(params: {
  workspaceId: string;
  reachableProjectIds: string[];
  projectId?: string;
  term: string;
  limit: number;
}) {
  const lower = params.term.toLowerCase();
  const prefix = `${escapeLikePattern(lower)}%`;
  const contains = `%${escapeLikePattern(lower)}%`;
  const descriptionText = sql<string>`coalesce(
    case
      when jsonb_typeof(${schema.workItemTable.description}) = 'string'
        then ${schema.workItemTable.description} #>> '{}'
      else jsonb_path_query_array(${schema.workItemTable.description}, 'lax $.**.text')::text
    end, '')`;
  const aliasMatch = db
    .select({ id: schema.workItemKeyAliasTable.workItemId })
    .from(schema.workItemKeyAliasTable)
    .where(sql`lower(${schema.workItemKeyAliasTable.oldKey}) = ${lower}`);
  const relevance = sql<number>`CASE
    WHEN lower(${schema.workItemTable.key}) = ${lower} THEN 100
    WHEN ${schema.workItemTable.id} IN (${aliasMatch}) THEN 90
    WHEN lower(${schema.workItemTable.key}) LIKE ${prefix} THEN 12
    WHEN lower(${schema.workItemTable.title}) = ${lower} THEN 10
    WHEN lower(${schema.workItemTable.title}) LIKE ${prefix} THEN 8
    WHEN lower(${schema.workItemTable.title}) LIKE ${contains} THEN 6
    WHEN lower(${descriptionText}) LIKE ${contains} THEN 2
    ELSE 1 END`;

  return db
    .select({
      id: schema.workItemTable.id,
      key: schema.workItemTable.key,
      title: schema.workItemTable.title,
      number: schema.workItemTable.number,
      priority: schema.workItemTable.priority,
      stateName: schema.stateTemplateTable.name,
      projectId: schema.workItemTable.projectId,
      projectName: schema.projectTable.name,
      projectSlug: schema.projectTable.slug,
      workspaceId: schema.workItemTable.workspaceId,
      workspaceName: schema.workspaceTable.name,
      createdAt: schema.workItemTable.createdAt,
      relevanceScore: relevance.as("relevance"),
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .innerJoin(
      schema.stateTable,
      and(
        eq(schema.stateTable.id, schema.workItemTable.stateId),
        eq(schema.stateTable.projectId, schema.workItemTable.projectId),
      ),
    )
    .innerJoin(
      schema.stateTemplateTable,
      eq(schema.stateTemplateTable.id, schema.stateTable.stateTemplateId),
    )
    .leftJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.workItemTable.workspaceId),
    )
    .where(
      and(
        eq(schema.workItemTable.workspaceId, params.workspaceId),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
        params.reachableProjectIds.length > 0
          ? inArray(schema.workItemTable.projectId, params.reachableProjectIds)
          : sql`false`,
        params.projectId
          ? eq(schema.workItemTable.projectId, params.projectId)
          : undefined,
        or(
          sql`lower(${schema.workItemTable.key}) LIKE ${prefix}`,
          sql`${schema.workItemTable.id} IN (${aliasMatch})`,
          ilike(schema.workItemTable.title, contains),
          sql`lower(${descriptionText}) LIKE ${contains}`,
        ),
      ),
    )
    .orderBy(
      desc(relevance),
      desc(schema.workItemTable.createdAt),
      schema.workItemTable.id,
    )
    .limit(params.limit);
}

describe("API integration: canonical global search", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("finds work items by key first, weights title above description, and drops deleted items", async () => {
    const { project, create, search } = await seedWorld();
    const target = await create("Quokka onboarding checklist");
    const other = await create("Unrelated");
    await db
      .update(schema.workItemTable)
      .set({
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "mentions quokka once" }],
            },
          ],
        },
      })
      .where(eq(schema.workItemTable.id, other.id));

    const byTitle = (await search("quokka")).filter(
      (r) => r.type === "work_item",
    );
    expect(byTitle.map((r) => r.id)).toEqual([target.id, other.id]);
    expect(byTitle[0]?.relevanceScore).toBeGreaterThan(
      byTitle[1]?.relevanceScore ?? 0,
    );

    const byKey = await search(target.key.toLowerCase());
    expect(byKey[0]).toMatchObject({
      type: "work_item",
      id: target.id,
      key: target.key,
    });

    // Structural jsonb keys such as "paragraph" must not match.
    const structural = await search("paragraph");
    expect(structural.some((r) => r.id === other.id)).toBe(false);

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, target.id));
    const afterDelete = await search("quokka");
    expect(afterDelete.map((r) => r.id)).not.toContain(target.id);
    expect(project.id).toBeTruthy();
  });

  it("SV-2: finds a work item by live comment text, never by a deleted comment or a hidden project's comment", async () => {
    const { member, type, template, app, create, search } = await seedWorld();
    const item = await create("Plain title");
    const comment = (text: string, workItemId: string, workspaceId: string) =>
      db.insert(schema.commentTable).values({
        workspaceId,
        workItemId,
        authorId: member.user.id,
        actorType: "person",
        visibility: "internal",
        body: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
      });
    await comment(
      "the pangolin escalation notes",
      item.id,
      member.workspace.id,
    );
    const hits = (await search("pangolin")).filter(
      (r) => r.type === "work_item",
    );
    expect(hits.map((r) => r.id)).toEqual([item.id]);

    await db
      .update(schema.commentTable)
      .set({ deletedAt: new Date(), body: null })
      .where(eq(schema.commentTable.workItemId, item.id));
    expect((await search("pangolin")).map((r) => r.id)).not.toContain(item.id);

    const hidden = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await provisionProject(
      member.workspace.id,
      hidden.project.id,
      type.id,
      template.id,
    );
    const insider = await addMember(member.workspace.id, "member");
    await grantProjectRole(insider.user.id, hidden.project.id, [
      "work_item:read",
      "work_item:create",
      "project:read",
    ]);
    const hiddenItem = await createItemAs(
      app,
      insider.user,
      hidden.project.id,
      type.id,
      "Hidden title",
    );
    await comment(
      "pangolin in a hidden project",
      hiddenItem.id,
      member.workspace.id,
    );
    mockAuthenticatedSession(member.user);
    expect((await search("pangolin")).map((r) => r.id)).not.toContain(
      hiddenItem.id,
    );
  });

  it("P1R2-8: comment text is searched only from three characters on, and the comment branch is bounded", async () => {
    const { member, create, search } = await seedWorld();
    const items = [];
    for (let index = 0; index < 4; index++)
      items.push(await create(`Untitled ${index}`));
    for (const item of items)
      await db.insert(schema.commentTable).values({
        workspaceId: member.workspace.id,
        workItemId: item.id,
        authorId: member.user.id,
        actorType: "person",
        visibility: "internal",
        body: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "zqx" }] },
          ],
        },
      });
    const twoChars = (await search("zq")).filter((r) => r.type === "work_item");
    expect(twoChars).toEqual([]);
    const threeChars = (await search("zqx")).filter(
      (r) => r.type === "work_item",
    );
    expect(threeChars.map((r) => r.id).sort()).toEqual(
      items.map((item) => item.id).sort(),
    );
  });

  it("falls back to trigram similarity for a typo", async () => {
    const { create, search } = await seedWorld();
    const item = await create("Quarterly planning review");
    const similar = await create("Quarterly plan review");

    // A valid title hit is complete; similarity matches must not pad it with
    // near-duplicates. This also prevents the fallback from sorting a whole
    // workspace for ordinary prefix/title typing.
    const direct = await search("Quarterly planning review");
    expect(
      direct.filter((result) => result.type === "work_item").map((r) => r.id),
    ).toEqual([item.id]);

    const fuzzy = await search("Quarterly planing reveiw");
    expect(fuzzy.map((r) => r.id)).toContain(item.id);
    expect(fuzzy.map((r) => r.id)).toContain(similar.id);
  });

  it("matches a two-character CJK title prefix", async () => {
    const { create, search } = await seedWorld();
    const item = await create("性能測試項目");
    const results = await search("性能");
    expect(results.filter((result) => result.type === "work_item")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: item.id })]),
    );
  });

  it("keeps branched search equivalent to the prior ranked query", async () => {
    const { member, project, type, template, app, create } = await seedWorld();
    const exactKey = await create("Unrelated exact key item");
    const exactTitle = await create("Needle");
    const prefixTitle = await create("Needle checklist");
    const containsTitle = await create("A quiet needle in the title");
    const descriptionOnly = await create("Description match only");
    const percentLiteral = await create("Literal token% marker");
    const percentWildcard = await create("Literal tokenX marker");
    const cjk = await create("性能測試項目");
    const archived = await create("Archived needle item");
    await db
      .update(schema.workItemTable)
      .set({
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "needle in the rich description" },
              ],
            },
          ],
        },
      })
      .where(eq(schema.workItemTable.id, descriptionOnly.id));
    await db
      .update(schema.workItemTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workItemTable.id, archived.id));

    // Retire an item's old key, then add a case-variant historical alias for the same id.
    // The two case-sensitive alias rows intentionally both match the lower(old_key) lookup.
    const oldKey = exactKey.key;
    const currentKey = `${project.slug}-renamed-${randomUUID()}`;
    await db
      .update(schema.workItemTable)
      .set({ key: currentKey, title: `Contains ${oldKey} in its title` })
      .where(eq(schema.workItemTable.id, exactKey.id));
    await db.insert(schema.workItemKeyAliasTable).values({
      oldKey,
      workItemId: exactKey.id,
    });
    const caseVariant = oldKey.toUpperCase();
    await db.insert(schema.workItemKeyClaimTable).values({
      key: caseVariant,
      workItemId: exactKey.id,
    });
    await db.insert(schema.workItemKeyAliasTable).values({
      oldKey: caseVariant,
      workItemId: exactKey.id,
    });

    // A matching item in an unreachable live project must not consume a branch's top-K.
    const hidden = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await provisionProject(
      member.workspace.id,
      hidden.project.id,
      type.id,
      template.id,
    );
    const insider = await addMember(member.workspace.id, "member");
    await grantProjectRole(insider.user.id, hidden.project.id, [
      "work_item:read",
      "work_item:create",
      "project:read",
    ]);
    const hiddenItem = await createItemAs(
      app,
      insider.user,
      hidden.project.id,
      type.id,
      "Needle hidden project",
    );

    const cases = [
      { term: "needle", limit: 20 },
      { term: "needle", limit: 1 },
      { term: oldKey, limit: 20 },
      { term: currentKey, limit: 20 },
      { term: "token%", limit: 20 },
      { term: "性能", limit: 20 },
    ];
    for (const testCase of cases) {
      const input = {
        workspaceId: member.workspace.id,
        reachableProjectIds: [project.id],
        ...testCase,
      };
      const [baseline, branched] = await Promise.all([
        searchCanonicalWorkItemsBaseline(input),
        searchCanonicalWorkItems(input),
      ]);
      expect(branched).toEqual(baseline);
    }

    const aliasResults = await searchCanonicalWorkItems({
      workspaceId: member.workspace.id,
      reachableProjectIds: [project.id],
      term: oldKey,
      limit: 20,
    });
    expect(aliasResults.filter((row) => row.id === exactKey.id)).toHaveLength(
      1,
    );
    expect(
      aliasResults.find((row) => row.id === exactKey.id)?.relevanceScore,
    ).toBe(90);

    const needleResults = await searchCanonicalWorkItems({
      workspaceId: member.workspace.id,
      reachableProjectIds: [project.id],
      term: "needle",
      limit: 20,
    });
    expect(needleResults.map((row) => row.id)).toEqual(
      expect.arrayContaining([
        exactTitle.id,
        prefixTitle.id,
        containsTitle.id,
        descriptionOnly.id,
      ]),
    );
    expect(needleResults.map((row) => row.id)).not.toContain(archived.id);
    expect(needleResults.map((row) => row.id)).not.toContain(hiddenItem.id);

    const escapedPercent = await searchCanonicalWorkItems({
      workspaceId: member.workspace.id,
      reachableProjectIds: [project.id],
      term: "token%",
      limit: 20,
    });
    expect(escapedPercent.map((row) => row.id)).toContain(percentLiteral.id);
    expect(escapedPercent.map((row) => row.id)).not.toContain(
      percentWildcard.id,
    );
    const cjkResults = await searchCanonicalWorkItems({
      workspaceId: member.workspace.id,
      reachableProjectIds: [project.id],
      term: "性能",
      limit: 20,
    });
    expect(cjkResults.map((row) => row.id)).toContain(cjk.id);
  });

  it("keeps canonical work items out of an API key without work_item:read", async () => {
    const { member, create, app } = await seedWorld();
    const item = await create("API key capability ceiling item");
    const key = await createPersonalApiKey(
      { userId: member.user.id },
      {
        name: "workspace search without work item access",
        capabilities: ["workspace:read"],
      },
    );
    mockAnonymousSession();

    const response = await app.request(
      `/api/search?q=${encodeURIComponent("API key capability ceiling")}&workspaceId=${member.workspace.id}&type=work_items`,
      { headers: { "x-api-key": key.key } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { results: Result[] };
    expect(body.results.map((result) => result.id)).not.toContain(item.id);
  });

  it("never returns work items from a project the caller cannot reach", async () => {
    const { member, type, template, app, create, search } = await seedWorld();
    const visible = await create("Walrus visible");
    // The hidden project holds a real, matching item created by someone who DOES reach it.
    const hidden = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await provisionProject(
      member.workspace.id,
      hidden.project.id,
      type.id,
      template.id,
    );
    const insider = await addMember(member.workspace.id, "member");
    await grantProjectRole(insider.user.id, hidden.project.id, [
      "work_item:read",
      "work_item:create",
      "project:read",
    ]);
    const hiddenItem = await createItemAs(
      app,
      insider.user,
      hidden.project.id,
      type.id,
      "Walrus hidden",
    );
    const [stored] = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, hiddenItem.id));
    expect(stored?.id).toBe(hiddenItem.id);

    mockAuthenticatedSession(member.user);
    const results = await search("walrus");
    const items = results.filter((r) => r.type === "work_item");
    expect(items.map((r) => r.id)).toEqual([visible.id]);
    expect(results.map((r) => r.id)).not.toContain(hiddenItem.id);
    // Not findable by its key either.
    const byKey = await search(hiddenItem.key);
    expect(byKey.map((r) => r.id)).not.toContain(hiddenItem.id);

    const hiddenFuzzy = await createItemAs(
      app,
      insider.user,
      hidden.project.id,
      type.id,
      "Cuttlefish provisioning exception",
    );
    mockAuthenticatedSession(member.user);
    const typoOnly = await search("Cuttlefish provisionng excepton");
    expect(typoOnly.map((r) => r.id)).not.toContain(hiddenFuzzy.id);
  });

  it("never returns another workspace's items, and refuses a search scoped to it", async () => {
    const { member, search } = await seedWorld();
    const foreign = await createWorkspaceMember({ role: "admin" });
    const foreignProject = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    await grantProjectRole(foreign.user.id, foreignProject.project.id, [
      "work_item:read",
      "work_item:create",
      "project:read",
    ]);
    const now = new Date();
    const [foreignType] = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: foreign.workspace.id,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!foreignType) throw new Error("foreign type fixture failed");
    await provisionProject(
      foreign.workspace.id,
      foreignProject.project.id,
      foreignType.id,
    );
    const { app } = createApp();
    const foreignItem = await createItemAs(
      app,
      foreign.user,
      foreignProject.project.id,
      foreignType.id,
      "Narwhal foreign",
    );

    mockAuthenticatedSession(member.user);
    const own = await search("narwhal");
    expect(own.map((r) => r.id)).not.toContain(foreignItem.id);
    const scopedToForeign = await app.request(
      `/api/search?q=narwhal&workspaceId=${foreign.workspace.id}`,
    );
    expect(scopedToForeign.status).not.toBe(200);
    expect(await scopedToForeign.text()).not.toContain(foreignItem.id);
  });

  it("a customer principal gets no staff work items from global search", async () => {
    const { member, create } = await seedWorld();
    const item = await create("Okapi internal");
    const customer = await createCustomerPrincipal();
    const identity = await resolveIdentity({
      userId: customer.user.id,
      credential: "session",
    });
    expect(identity?.side).toBe("customer");

    mockAuthenticatedSession(customer.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/search?q=okapi&workspaceId=${member.workspace.id}`,
    );
    const body = await response.text();
    expect([200, 401, 403, 404]).toContain(response.status);
    expect(body).not.toContain(item.id);
  });

  it("returns the caller's own saved views and workspace members by name", async () => {
    const { member, search } = await seedWorld();
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id));
    if (!person) throw new Error("fixture person missing");
    await db.insert(schema.savedViewTable).values({
      workspaceId: member.workspace.id,
      createdBy: person.id,
      name: "Lemur backlog",
      scope: "workspace",
      scopeId: member.workspace.id,
      visibility: "private",
      query: { entity: "work_item" },
      layout: "list",
    });
    const views = await search("lemur");
    expect(views.map((r) => r.type)).toContain("saved_view");
    const people = await search(member.user.name.slice(0, 4));
    expect(people.some((r) => r.type === "person" && r.id === person.id)).toBe(
      true,
    );
  });
});
