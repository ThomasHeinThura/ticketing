import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "../notification-preferences/secrets";
import {
  loadApprovalAuthoringFacts,
  scanApprovalCandidatePeople,
} from "./authoring-repository";
import {
  hasApprovalCapability,
  hasPortalApprovalDecideCapability,
  hasWorkItemReach,
  isCabTeamMember,
  loadApprovalTargetByKey,
  resolveApprovalFeatureFlag,
  resolveApprovalIdentityIfActive,
} from "./repository";

export async function approvalRequestContext(
  identity: ResolvedIdentity,
  key: string,
) {
  const target = await loadApprovalTargetByKey(identity, key);
  if (!(await hasWorkItemReach(identity, target)))
    throw new HTTPException(404, { message: "Work item not found" });
  if (
    identity.side !== "staff" ||
    !hasApprovalCapability(identity, "work_item:read", target)
  )
    throw new HTTPException(403, { message: "Forbidden" });
  const [flag, facts] = await Promise.all([
    resolveApprovalFeatureFlag({
      identity,
      workspaceId: target.workspaceId,
      projectId: target.projectId,
    }),
    loadApprovalAuthoringFacts(target),
  ]);
  const canRequestCustomer =
    flag.enabled && hasApprovalCapability(identity, "approval:request", target);
  const canRequestCab =
    canRequestCustomer &&
    facts.isChange &&
    hasApprovalCapability(identity, "approval:request_cab", target);
  return {
    target,
    context: {
      enabled: flag.enabled,
      canRequestCustomer,
      canRequestCab,
      defaultExpiryDays: facts.defaultExpiryDays,
      maxExpiryDays: 90,
      transitions: canRequestCustomer
        ? facts.transitions.filter(
            (transition) =>
              transition.requiresApproval ||
              (canRequestCab && transition.requiresCab),
          )
        : [],
    },
  };
}

type CandidateInput = {
  kind: "customer" | "cab";
  q: string;
  cursor?: string;
  limit: number;
};
function decodeCursor(
  input: CandidateInput,
  key: string,
  requesterId: string,
): string | undefined {
  if (!input.cursor) return undefined;
  try {
    if (!isEncryptedSecret(input.cursor)) throw new Error("Invalid cursor");
    const envelope = /^enc:v2:([A-Za-z0-9_-]+)$/u.exec(input.cursor);
    if (
      !envelope ||
      Buffer.from(envelope[1] ?? "", "base64url").toString("base64url") !==
        envelope[1]
    )
      throw new Error("Invalid cursor");
    const plaintext = decryptSecret(input.cursor);
    if (!plaintext) throw new Error("Invalid cursor");
    const value = JSON.parse(plaintext) as {
      id?: unknown;
      kind?: unknown;
      q?: unknown;
      key?: unknown;
      requesterId?: unknown;
      purpose?: unknown;
    };
    if (
      typeof value.id !== "string" ||
      value.id.length > 256 ||
      !value.id ||
      value.kind !== input.kind ||
      value.q !== input.q ||
      value.key !== key ||
      value.requesterId !== requesterId ||
      value.purpose !== "approval-candidates" ||
      Array.from(value.id).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error("Invalid cursor");
    return value.id;
  } catch {
    throw new HTTPException(400, { message: "Invalid candidate cursor" });
  }
}

export async function approvalCandidates(
  identity: ResolvedIdentity,
  key: string,
  input: CandidateInput,
) {
  const { target, context } = await approvalRequestContext(identity, key);
  if (!context.enabled)
    throw new HTTPException(404, { message: "Approval requests are disabled" });
  if (
    !context.canRequestCustomer ||
    (input.kind === "cab" && !context.canRequestCab)
  )
    throw new HTTPException(403, { message: "Forbidden" });
  const after = decodeCursor(input, key, identity.personId);
  const scan = await scanApprovalCandidatePeople({
    ...input,
    after,
    requesterId: identity.personId,
    limit: 101,
  });
  const data: { id: string; displayName: string | null }[] = [];
  let last: string | undefined;
  let examined = 0;
  for (const person of scan.slice(0, 100)) {
    last = person.id;
    examined++;
    if (!person.userId) continue;
    const candidate = await resolveApprovalIdentityIfActive(person.userId);
    if (!candidate || !(await hasWorkItemReach(candidate, target))) continue;
    if (
      input.kind === "cab" &&
      (!(await isCabTeamMember(
        identity,
        person.userId,
        target.workspaceId,
        target.workItemId,
      )) ||
        !hasApprovalCapability(candidate, "approval:decide_cab", target))
    )
      continue;
    if (
      input.kind === "customer" &&
      !hasPortalApprovalDecideCapability(candidate, target)
    )
      continue;
    data.push({ id: person.id, displayName: person.displayName });
    if (data.length >= input.limit) break;
  }
  const hasMore = examined < scan.length;
  return {
    data,
    page: {
      hasMore,
      nextCursor:
        hasMore && last
          ? (encryptSecret(
              JSON.stringify({
                purpose: "approval-candidates",
                id: last,
                kind: input.kind,
                q: input.q,
                key,
                requesterId: identity.personId,
              }),
            ) ?? null)
          : null,
    },
  };
}
