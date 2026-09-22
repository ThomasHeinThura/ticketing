export type InstanceStatus = {
  status: "ok";
};

/**
 * #18: this used to return `{ hasUsers, hasAdmin }`, computed live from the
 * user table and served unauthenticated. That let anyone scan for an
 * unclaimed TaskDesk instance and race its operator to become its admin
 * (docs/07-planning/security-reviews/13-kaneo-import-lenses/E-secrets.md,
 * finding E-13). The route stays public (the frontend calls it before a
 * session exists), but its response is now a constant that carries no
 * information about whether the instance has been claimed. First-run setup
 * is reached through the one-time setup URL and token printed to the
 * container log (auth-and-identity.md § Break-glass), not discovered here.
 */
async function getInstanceStatus(): Promise<InstanceStatus> {
  return { status: "ok" };
}

export default getInstanceStatus;
