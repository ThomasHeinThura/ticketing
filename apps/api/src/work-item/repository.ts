import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import type db from "../database";
import {
  slaPolicyTable,
  slaPolicyVersionTable,
  workspaceTable,
} from "../database/schema";
import type { DbTransaction } from "../events/outbox";

/**
 * Minimal executor seam for the three frozen SLA lookups used by intake conversion.
 * The broader work-item query repository remains outside this integration slice.
 */
type Executor = Pick<typeof db, "select"> | Pick<DbTransaction, "select">;

export async function findWorkspaceDefaultSlaPolicyQuery(
  executor: Executor,
  workspaceId: string,
) {
  return executor
    .select({ slaPolicyId: workspaceTable.defaultSlaPolicyId })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
}

export async function findWorkspaceOwnedSlaPolicyQuery(
  executor: Executor,
  policyId: string,
  workspaceId: string,
) {
  return executor
    .select({ id: slaPolicyTable.id })
    .from(slaPolicyTable)
    .where(
      and(
        eq(slaPolicyTable.id, policyId),
        eq(slaPolicyTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
}

export async function findEffectiveSlaPolicyVersionQuery(
  executor: Executor,
  workspaceId: string,
  policyId: string,
  slaStartedAt: Date,
) {
  return executor
    .select({ id: slaPolicyVersionTable.id })
    .from(slaPolicyVersionTable)
    .where(
      and(
        eq(slaPolicyVersionTable.workspaceId, workspaceId),
        eq(slaPolicyVersionTable.policyId, policyId),
        isNotNull(slaPolicyVersionTable.effectiveFrom),
        lte(slaPolicyVersionTable.effectiveFrom, slaStartedAt),
      ),
    )
    .orderBy(
      desc(slaPolicyVersionTable.effectiveFrom),
      desc(slaPolicyVersionTable.number),
    )
    .limit(1);
}
