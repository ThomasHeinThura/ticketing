import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import {
  labelTable,
  projectTable,
  stateTable,
  workItemKeyAliasTable,
  workItemLabelTable,
  workItemTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { lockRankPartition } from "../../scheduler/position-rebalance";
import { callerReach } from "../../utils/caller-reach";
import { isRaiseException } from "../../utils/is-raise-exception";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import {
  assertCallerHasCapability,
  capabilityCredential,
} from "../../utils/require-workspace-capability";
import {
  type ActivityActorType,
  type NewActivityInput,
  recordWorkItemActivity,
} from "../activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../assert-work-item-live";
import { resolveAssigneeEligibility } from "../assignee-eligibility";
import { WORK_ITEM_HIERARCHY_LOCK_NAMESPACE } from "../hierarchy-lock";
import {
  checkMoveSize,
  collectSubtree,
  exposesAcrossOrganisations,
  movedKey,
  planLabelMove,
  planPositionOrdinals,
  planStateMapping,
} from "../move-plan";
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";
import { runWithParentWriteDeadlockRetry } from "../parent-write-deadlock-retry";
import { WorkItemVersionConflictError } from "./update-work-item";

type WorkItemRow = typeof workItemTable.$inferSelect;

export type MoveWorkItemInput = {
  key: string;
  workspaceId: string;
  /** The project the reach middleware authorised the source item in. */
  authorisedSourceProjectId: string;
  target: AuthorisedMoveTarget;
  moveChildren: boolean;
  assertedVersion: number;
  actorId: string;
  actorType: ActivityActorType;
};

export type AuthorisedMoveTarget = {
  id: string;
  workspaceId: string;
  organisationId: string | null;
};

/**
 * Decides whether the caller may move work INTO `targetProjectId` (`RH-12`: reach and capability
 * on BOTH projects; the source side is decided by `requireWorkItemReach` +
 * `requireWorkspaceCapability("work_item:update")` on the route).
 *
 * Answers, in order:
 * - a missing, deleted, archived, other-workspace or unreachable target is one and the same 404
 *   ("Target project not found"), so the route is no oracle for another tenant's or a hidden
 *   project's existence;
 * - a reachable target where the caller lacks `work_item:create` or `work_item:update` is 403;
 * - an API key must also hold the capability in its stored scope.
 */
export async function authoriseMoveTarget(
  c: Context,
  userId: string,
  workspaceId: string,
  targetProjectId: string,
): Promise<AuthorisedMoveTarget> {
  const [project] = await db
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      organisationId: projectTable.organisationId,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, targetProjectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    )
    .limit(1);
  const notFound = new HTTPException(404, {
    message: "Target project not found",
  });
  if (!project) throw notFound;
  const reach = await callerReach(c, userId);
  const reachRow = {
    projectId: project.id,
    workspaceId: project.workspaceId,
    organisationId: project.organisationId,
  };
  if (!(await reach.reaches(reachRow))) throw notFound;
  for (const capability of ["work_item:create", "work_item:update"] as const) {
    if (!(await reach.can(capability, reachRow)))
      throw new HTTPException(403, { message: "Insufficient permissions" });
    await assertCallerHasCapability(
      workspaceId,
      userId,
      capability,
      capabilityCredential(c.get("apiKey")),
    );
  }
  return project;
}

/**
 * `POST /api/v2/work-items/{key}/move` (`RH-12`): moves a work item (and, by choice, its whole
 * subtree) to another project of the SAME workspace. See `../move-plan.ts` for the documented
 * rules (parent link, children, state remap, labels). In one transaction:
 *
 * 1. LOCKS, always in this order: both projects' hierarchy advisory locks (sorted by id, so two
 *    opposing moves serialise rather than deadlock; the same namespace `set-work-item-parent.ts`
 *    takes) -> the target project row `FOR UPDATE` (its number counter) and the source project
 *    `FOR SHARE` -> the item row, then the whole subtree `FOR UPDATE` -> each target column's rank
 *    partition lock. The item's `projectId`/`version` are re-checked after the lock (409), so a
 *    concurrent move or edit between the middleware and the lock cannot be overwritten.
 * 2. REFUSALS (422, nothing written): same project; subtree larger than the cap; a state template
 *    the target project does not use; an assignee not on the target roster or inactive; a
 *    requester-bearing or organisation-visible item moving between different customer
 *    organisations.
 * 3. COMPOSITE FKs: `(project_id, parent_id)` and `(project_id, state_id)` are NO ACTION and
 *    `scheduled_transition` carries `(project_id, work_item_id)` plus from/to state FKs. The parent
 *    link is cleared first (own statement), `scheduled_transition` rows of the moved items are
 *    deleted (workflow timers are bound to the old project's states and are not history; the
 *    activity log is), and the whole moved set then changes `project_id`/`state_id` in ONE multi-row
 *    UPDATE, so every self-referencing FK holds at statement end.
 * 4. Per row: a fresh number from the target's counter, key `{target.slug}-{number}` (the claim
 *    trigger registers it exactly once), an old-key row in `work_item_key_alias`, appended
 *    position in the mapped column, cleared cycle/module/estimate pointers (project-scoped,
 *    P5), version + 1, `updated` activity (`project`, plus `label`/`parent` when they changed)
 *    and an audit row.
 */
export async function moveWorkItem(input: MoveWorkItemInput) {
  const [pre] = await db
    .select({ projectId: workItemTable.projectId })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, input.key),
        eq(workItemTable.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!pre) throw new HTTPException(404, { message: "Work item not found" });
  if (pre.projectId === input.target.id)
    throw new HTTPException(422, {
      message: "The work item is already in that project",
    });

  const result = await runWithParentWriteDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const lockIds = [...new Set([pre.projectId, input.target.id])].sort();
      for (const projectId of lockIds)
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${WORK_ITEM_HIERARCHY_LOCK_NAMESPACE}, hashtext(${projectId}))`,
        );

      const [target] = await tx
        .select()
        .from(projectTable)
        .where(
          and(
            eq(projectTable.id, input.target.id),
            eq(projectTable.workspaceId, input.workspaceId),
            isNull(projectTable.deletedAt),
            isNull(projectTable.archivedAt),
          ),
        )
        .for("update");
      if (!target)
        throw new HTTPException(404, { message: "Target project not found" });
      if (target.organisationId !== input.target.organisationId)
        throw new HTTPException(409, {
          message:
            "The target project changed while the move was being prepared; reload and retry",
        });

      const [item] = await tx
        .select()
        .from(workItemTable)
        .where(
          and(
            eq(workItemTable.key, input.key),
            eq(workItemTable.workspaceId, input.workspaceId),
          ),
        )
        .for("update");
      assertWorkItemStillLive(item);
      if (
        item.projectId !== pre.projectId ||
        item.projectId !== input.authorisedSourceProjectId
      )
        throw new HTTPException(409, {
          message:
            "The work item's project changed concurrently; reload and retry",
        });
      await assertProjectStillLive(tx, item.projectId);
      if (item.version !== input.assertedVersion)
        throw new WorkItemVersionConflictError(
          input.assertedVersion,
          item.version,
        );
      if (item.projectId === target.id)
        throw new HTTPException(422, {
          message: "The work item is already in that project",
        });

      const [source] = await tx
        .select()
        .from(projectTable)
        .where(eq(projectTable.id, item.projectId))
        .limit(1);
      if (!source || source.workspaceId !== target.workspaceId)
        throw new HTTPException(404, { message: "Target project not found" });

      // Moving children: the whole subtree (every descendant, deleted and archived rows
      // included, because their `parent_id` keeps pointing inside the tree). Detaching: only the
      // item and its direct children. Rows are locked in id order after the size check.
      const treeIds = input.moveChildren
        ? (
            await tx.execute<{ id: string }>(sql`
              WITH RECURSIVE tree(id, depth) AS (
                SELECT ${item.id}::text, 0
                UNION
                SELECT child.id, tree.depth + 1 FROM work_item child
                  JOIN tree ON child.parent_id = tree.id
                  WHERE child.project_id = ${item.projectId} AND tree.depth < 50
              )
              SELECT id FROM tree
            `)
          ).rows.map((row) => row.id)
        : null;
      const refusedSize = treeIds ? checkMoveSize(treeIds.length) : null;
      if (refusedSize)
        throw new HTTPException(422, {
          message: `The subtree has ${refusedSize.size} work items; move at most 200 at once`,
        });
      const subtreeRows = await tx
        .select()
        .from(workItemTable)
        .where(
          treeIds
            ? inArray(workItemTable.id, treeIds)
            : and(
                eq(workItemTable.projectId, item.projectId),
                or(
                  eq(workItemTable.id, item.id),
                  eq(workItemTable.parentId, item.id),
                ),
              ),
        )
        .orderBy(asc(workItemTable.id))
        .for("update");
      const subtreeIds = collectSubtree(subtreeRows, item.id);

      const byId = new Map(subtreeRows.map((row) => [row.id, row]));
      const movingIds = input.moveChildren ? subtreeIds : [item.id];
      const moving = movingIds
        .map((id) => byId.get(id))
        .filter((row): row is WorkItemRow => row !== undefined);
      const detaching = [
        ...(item.parentId !== null ? [item] : []),
        ...(input.moveChildren
          ? []
          : subtreeRows.filter((row) => row.parentId === item.id)),
      ];

      if (
        exposesAcrossOrganisations(
          source.organisationId,
          target.organisationId,
          moving,
        )
      )
        throw new HTTPException(422, {
          message:
            "Work items with a requester or organisation visibility cannot move to a project of a different customer organisation",
        });

      const [sourceStates, targetStates] = await Promise.all([
        tx.select().from(stateTable).where(eq(stateTable.projectId, source.id)),
        tx
          .select()
          .from(stateTable)
          .where(eq(stateTable.projectId, target.id))
          .for("share"),
      ]);
      const mapping = planStateMapping(
        moving.map((row) => row.stateId),
        sourceStates,
        targetStates,
      );
      if (!mapping.ok)
        throw new HTTPException(422, {
          message:
            "The target project has no live state matching this work item's workflow state; add the state to the target project first",
        });

      const assigneeIds = [
        ...new Set(
          moving
            .map((row) => row.assigneeId)
            .filter((id): id is string => id !== null),
        ),
      ].sort();
      const ineligible: string[] = [];
      for (const personId of assigneeIds)
        if (
          !(await resolveAssigneeEligibility(tx, target.id, personId)).eligible
        )
          ineligible.push(personId);
      if (ineligible.length)
        throw new HTTPException(422, {
          message:
            "An assignee is not an active member of the target project; reassign the work item first",
        });

      // Labels: workspace-wide ones stay, project-scoped ones follow by name or are dropped.
      const assignedLabels = await tx
        .select({
          workItemId: workItemLabelTable.workItemId,
          id: labelTable.id,
          name: labelTable.name,
          projectId: labelTable.projectId,
        })
        .from(workItemLabelTable)
        .innerJoin(labelTable, eq(labelTable.id, workItemLabelTable.labelId))
        .where(
          inArray(
            workItemLabelTable.workItemId,
            moving.map((row) => row.id),
          ),
        );
      const targetLabels = await tx
        .select({ id: labelTable.id, name: labelTable.name })
        .from(labelTable)
        .where(
          and(
            eq(labelTable.workspaceId, input.workspaceId),
            eq(labelTable.projectId, target.id),
            isNull(labelTable.taskId),
          ),
        )
        .for("key share");
      const labelPlans = new Map(
        moving.map((row) => [
          row.id,
          planLabelMove(
            assignedLabels.filter((label) => label.workItemId === row.id),
            targetLabels,
          ),
        ]),
      );

      const movingIdList = moving.map((row) => row.id);
      await tx.execute(
        sql`DELETE FROM scheduled_transition WHERE work_item_id = ANY(${sql.param(movingIdList)}::text[])`,
      );

      // Clear the parent link (and detach direct children) before the project changes.
      const detachingIds = detaching.map((row) => row.id);
      if (detachingIds.length)
        await tx
          .update(workItemTable)
          .set({
            parentId: null,
            version: sql`${workItemTable.version} + 1`,
            updatedAt: new Date(),
          })
          .where(inArray(workItemTable.id, detachingIds));

      // Positions append to the bottom of each mapped column under the rank-partition locks.
      const orderedForPosition = [...moving].sort(
        (a, b) =>
          Number(a.position) - Number(b.position) || a.id.localeCompare(b.id),
      );
      const targetStateIds = [
        ...new Set(moving.map((row) => mapping.map.get(row.stateId) as string)),
      ].sort();
      for (const stateId of targetStateIds)
        await lockRankPartition(tx, {
          workspaceId: input.workspaceId,
          projectId: target.id,
          stateId,
        });
      const ordinals = planPositionOrdinals(
        orderedForPosition.map((row) => ({
          id: row.id,
          stateId: mapping.map.get(row.stateId) as string,
        })),
      );

      // Numbers: one increment on the (already locked) target counter, handed out in the
      // items' old number order.
      const [counter] = await tx
        .update(projectTable)
        .set({
          lastTaskNumber: sql`${projectTable.lastTaskNumber} + ${moving.length}`,
        })
        .where(eq(projectTable.id, target.id))
        .returning({ lastTaskNumber: projectTable.lastTaskNumber });
      if (!counter)
        throw new HTTPException(404, { message: "Target project not found" });
      const firstNumber = counter.lastTaskNumber - moving.length + 1;
      const plan = moving.map((row, index) => ({
        row,
        number: firstNumber + index,
        key: movedKey(target.slug, firstNumber + index),
        stateId: mapping.map.get(row.stateId) as string,
        ordinal: ordinals.get(row.id) as number,
      }));

      const now = new Date();
      try {
        await tx.execute(sql`
          UPDATE work_item AS w SET
            project_id = ${target.id},
            state_id = m.state_id,
            number = m.number,
            key = m.key,
            position = COALESCE((
              SELECT max(p.position) FROM work_item p
              WHERE p.project_id = ${target.id} AND p.state_id = m.state_id
                AND p.deleted_at IS NULL AND p.archived_at IS NULL
            ), 0) + m.ordinal,
            cycle_id = NULL, module_id = NULL, estimate_point_id = NULL,
            version = w.version + 1,
            updated_at = (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
          FROM (VALUES ${sql.join(
            plan.map(
              (entry) =>
                sql`(${entry.row.id}::text, ${entry.stateId}::text, ${entry.number}::integer, ${entry.key}::text, ${entry.ordinal}::integer)`,
            ),
            sql`, `,
          )}) AS m(id, state_id, number, key, ordinal)
          WHERE w.id = m.id
        `);
      } catch (error) {
        if (isUniqueViolation(error, "work_item_key_claim_pkey"))
          throw new HTTPException(409, {
            message:
              "A generated work item key is already claimed; the target project's key range may be poisoned by a retired slug -- contact an administrator",
          });
        if (isRaiseException(error))
          throw new HTTPException(409, {
            message:
              "Could not move -- a concurrent change affected this hierarchy; reload and retry",
          });
        throw error;
      }

      await tx.insert(workItemKeyAliasTable).values(
        plan.map((entry) => ({
          oldKey: entry.row.key,
          workItemId: entry.row.id,
        })),
      );

      let droppedLabelCount = 0;
      for (const entry of plan) {
        const labelPlan = labelPlans.get(entry.row.id);
        if (!labelPlan) continue;
        const changed = [
          ...labelPlan.dropped,
          ...labelPlan.remapped.map((pair) => pair.from),
        ];
        if (!changed.length) continue;
        droppedLabelCount += labelPlan.dropped.length;
        await tx
          .delete(workItemLabelTable)
          .where(
            and(
              eq(workItemLabelTable.workItemId, entry.row.id),
              inArray(workItemLabelTable.labelId, changed),
            ),
          );
        if (labelPlan.remapped.length)
          await tx
            .insert(workItemLabelTable)
            .values(
              labelPlan.remapped.map((pair) => ({
                workItemId: entry.row.id,
                labelId: pair.to,
              })),
            )
            .onConflictDoNothing();
      }

      const activity: NewActivityInput[] = plan.flatMap((entry) => [
        {
          workspaceId: input.workspaceId,
          workItemId: entry.row.id,
          actorId: input.actorId,
          actorType: input.actorType,
          verb: "updated",
          field: "project",
          oldValue: { projectId: source.id, key: entry.row.key },
          newValue: { projectId: target.id, key: entry.key },
          payload: {
            fromStateId: entry.row.stateId,
            toStateId: entry.stateId,
            moveChildren: input.moveChildren,
          },
          visibility: "internal" as const,
        },
        ...((labelPlans.get(entry.row.id)?.dropped.length ?? 0) +
          (labelPlans.get(entry.row.id)?.remapped.length ?? 0) >
        0
          ? [
              {
                workspaceId: input.workspaceId,
                workItemId: entry.row.id,
                actorId: input.actorId,
                actorType: input.actorType,
                verb: "updated",
                field: "label",
                oldValue: assignedLabels
                  .filter((label) => label.workItemId === entry.row.id)
                  .map((label) => label.id)
                  .sort(),
                newValue: labelPlans.get(entry.row.id)?.after ?? [],
                visibility: "internal" as const,
              },
            ]
          : []),
      ]);
      for (const row of detaching)
        activity.push({
          workspaceId: input.workspaceId,
          workItemId: row.id,
          actorId: input.actorId,
          actorType: input.actorType,
          verb: "updated",
          field: "parent",
          oldValue: row.parentId,
          newValue: null,
          visibility: "internal",
        });
      await recordWorkItemActivity(tx, activity);

      for (const entry of plan)
        await appendAuditLog(tx, {
          actorId: input.actorId,
          actorType: input.actorType,
          workspaceId: input.workspaceId,
          projectId: target.id,
          action: "work_item.updated",
          entityType: "work_item",
          entityId: entry.row.id,
          before: {
            projectId: source.id,
            key: entry.row.key,
            stateId: entry.row.stateId,
          },
          after: {
            projectId: target.id,
            key: entry.key,
            stateId: entry.stateId,
            rootWorkItemId: item.id,
            moveChildren: input.moveChildren,
          },
        });

      const events = [] as Array<{
        event: Awaited<ReturnType<typeof recordWorkItemEvent>>;
        key: string;
        fromProjectId: string;
        toProjectId: string;
        fromKey: string;
        workItemId: string;
      }>;
      for (const entry of plan) {
        const event = await recordWorkItemEvent(tx, {
          kind: "work_item.updated",
          workItemId: entry.row.id,
          key: entry.key,
          workspaceId: input.workspaceId,
          projectId: target.id,
          actorId: input.actorId,
          actorType: input.actorType,
          customerVisible: false,
          payload: {
            key: entry.key,
            url: `/agent/work-items/${encodeURIComponent(entry.key)}`,
            changes: [
              {
                field: "project",
                from: source.id,
                to: target.id,
                visibility: "internal",
              },
              {
                field: "key",
                from: entry.row.key,
                to: entry.key,
                visibility: "internal",
              },
            ],
          },
        });
        events.push({
          event,
          key: entry.key,
          fromProjectId: source.id,
          toProjectId: target.id,
          fromKey: entry.row.key,
          workItemId: entry.row.id,
        });
      }
      const detachedEvents = [] as Array<{
        event: Awaited<ReturnType<typeof recordWorkItemEvent>>;
        row: WorkItemRow;
      }>;
      for (const row of detaching.filter(
        (candidate) => !movingIdList.includes(candidate.id),
      )) {
        const event = await recordWorkItemEvent(tx, {
          kind: "work_item.updated",
          workItemId: row.id,
          key: row.key,
          workspaceId: input.workspaceId,
          projectId: row.projectId,
          actorId: input.actorId,
          actorType: input.actorType,
          customerVisible: false,
          payload: {
            key: row.key,
            url: `/agent/work-items/${encodeURIComponent(row.key)}`,
            changes: [
              {
                field: "parent",
                from: row.parentId,
                to: null,
                visibility: "internal",
              },
            ],
          },
        });
        detachedEvents.push({ event, row });
      }

      const [moved] = await tx
        .select()
        .from(workItemTable)
        .where(eq(workItemTable.id, item.id))
        .limit(1);
      if (!moved)
        throw new HTTPException(404, { message: "Work item not found" });
      return {
        moved,
        plan,
        events,
        detachedEvents,
        detachedChildKeys: input.moveChildren
          ? []
          : detaching.filter((row) => row.id !== item.id).map((row) => row.key),
        droppedLabelCount,
        sourceProjectId: source.id,
        targetProjectId: target.id,
      };
    }),
  );

  for (const entry of result.events) {
    for (const projectId of [entry.fromProjectId, entry.toProjectId])
      await publishWorkItemHint(entry.event, {
        kind: "work_item.updated",
        key: entry.key,
        projectId,
        customerVisible: false,
      });
    await publishEvent("work_item.updated", {
      workItemId: entry.workItemId,
      key: entry.key,
      workspaceId: input.workspaceId,
      projectId: entry.toProjectId,
      changes: [
        {
          field: "project",
          from: entry.fromProjectId,
          to: entry.toProjectId,
          visibility: "internal",
        },
        {
          field: "key",
          from: entry.fromKey,
          to: entry.key,
          visibility: "internal",
        },
      ],
      actorId: input.actorId,
      actorType: input.actorType,
    });
  }
  for (const { event, row } of result.detachedEvents) {
    await publishWorkItemHint(event, {
      kind: "work_item.updated",
      key: row.key,
      projectId: row.projectId,
      customerVisible: false,
    });
    await publishEvent("work_item.updated", {
      workItemId: row.id,
      key: row.key,
      workspaceId: input.workspaceId,
      projectId: row.projectId,
      changes: [
        {
          field: "parent",
          from: row.parentId,
          to: null,
          visibility: "internal",
        },
      ],
      actorId: input.actorId,
      actorType: input.actorType,
    });
  }

  return {
    item: result.moved,
    moved: result.plan.map((entry) => ({
      id: entry.row.id,
      fromKey: entry.row.key,
      toKey: entry.key,
    })),
    detachedChildKeys: result.detachedChildKeys,
    droppedLabelCount: result.droppedLabelCount,
  };
}

export default moveWorkItem;
