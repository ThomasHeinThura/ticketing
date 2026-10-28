import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { listWorkspaceFeatures } from "../feature-flag/repository";
import type { GovernanceActor } from "../team/audit";

export const SERVICE_CATALOGUE_FEATURE = "feature.service_catalogue" as const;

/** The workspace's `feature.service_catalogue` flag. Fails closed on an unreadable flag. */
export async function serviceCatalogueEnabled(
  workspaceId: string,
): Promise<boolean> {
  try {
    const features = await listWorkspaceFeatures(workspaceId);
    return (
      features.find((entry) => entry.key === SERVICE_CATALOGUE_FEATURE)
        ?.enabled === true
    );
  } catch {
    return false;
  }
}

/** Refuse with `409 feature_disabled` while the service catalogue is off for the workspace. */
export async function requireServiceCatalogue(
  workspaceId: string,
): Promise<void> {
  if (!(await serviceCatalogueEnabled(workspaceId)))
    throw new HTTPException(409, { message: "feature_disabled" });
}

export function actorOf(c: Context): GovernanceActor {
  const apiKey = c.get("apiKey") as { id: string } | undefined;
  return {
    userId: c.get("userId") as string,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
  };
}

export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  } | null;
  const code = e?.code ?? e?.cause?.code;
  const name = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && (constraint === undefined || name === constraint);
}

export class VersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super("version_conflict");
  }
}
