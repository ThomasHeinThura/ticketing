export { IdentityGrantClosureChangedError } from "./errors";
export { retryIdentityGrantClosure } from "./grant-closure-retry";
export type { MembershipProjectionKey } from "./repository";
export {
  lockScimGrantClosure,
  projectMembershipKeys,
  retireConnectionGrantSources,
  retireConnectionGrantsAboveRoleRank,
  retireConnectionJitGrants,
  retireScimGroupGrants,
} from "./repository";
