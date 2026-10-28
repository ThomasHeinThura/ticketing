import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../database";
import type {
  RegisteredDeletionLoaded,
  RegisteredDeletionTarget,
} from "./click-deletion-executor";

export const ORGANISATION_DELETION_ROUTE =
  "DELETE /api/instance/organisations/{id}" as const;

type OrganisationDeletionLoaded = RegisteredDeletionLoaded<null>;

export function organisationDeletionVersion(
  profileEtag: string,
  generation: number,
) {
  return JSON.stringify({ profileEtag, generation });
}

/**
 * Organisation deletion is an instance action. Its target fingerprint binds both the exact
 * lifecycle profile ETag and monotonic deletion generation, so edit/restore/delete ABA cannot
 * revive an old approval.
 */
export const organisationDeletionTarget: RegisteredDeletionTarget<OrganisationDeletionLoaded> =
  {
    targetType: "organisation",
    routeKey: ORGANISATION_DELETION_ROUTE,
    confirmation: "typed_name_step_up",
    sessionOnly: true,
    notFound: "Organisation not found",
    async load(tx, id) {
      const { loadOrganisationProfileForDeletion } = await import(
        "../instance/organisation-lifecycle"
      );
      const loaded = await loadOrganisationProfileForDeletion(tx, id);
      if (!loaded) return undefined;
      const [row] = await tx
        .select({ deletedAt: schema.organisationTable.deletedAt })
        .from(schema.organisationTable)
        .where(eq(schema.organisationTable.id, id))
        .limit(1);
      if (!row || row.deletedAt) return undefined;
      return {
        id,
        workspaceId: null,
        projectId: null,
        organisationId: id,
        name: loaded.profile.name,
        summary: {
          id,
          key: loaded.profile.key,
          name: loaded.profile.name,
        },
        version: organisationDeletionVersion(
          loaded.profile.profileEtag,
          loaded.generation,
        ),
      };
    },
    async execute(tx, { row, loaded, input }) {
      const { softDeleteOrganisationInTransaction } = await import(
        "../instance/organisation-lifecycle"
      );
      let expected: { profileEtag: string; generation: number };
      try {
        const parsed: unknown = JSON.parse(loaded.version);
        if (
          !parsed ||
          typeof parsed !== "object" ||
          typeof (parsed as Record<string, unknown>).profileEtag !== "string" ||
          !Number.isSafeInteger((parsed as Record<string, unknown>).generation)
        )
          throw new Error("Invalid organisation target version");
        expected = {
          profileEtag: (parsed as { profileEtag: string }).profileEtag,
          generation: (parsed as { generation: number }).generation,
        };
      } catch {
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      }
      const result = await softDeleteOrganisationInTransaction(tx, {
        organisationId: loaded.id,
        expectedProfileEtag: expected.profileEtag,
        expectedGeneration: expected.generation,
        operationId: row.id,
        actorUserId: input.userId,
        traceId: input.traceId,
      });
      if (result.kind === "not_found")
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      if (result.kind === "conflict")
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      return {};
    },
  };
