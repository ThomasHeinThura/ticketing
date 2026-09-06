/**
 * `@taskdesk/permissions` — capabilities, roles, the route-policy registry and the evaluator.
 *
 * Two axes, never mixed: **reach** (what you can see) and **authority** (what you can change).
 * Everything here is pure — no I/O, no database, no framework — so the same code answers a
 * question in the API middleware, in a test and in a CI check.
 *
 * The anti-v1 mechanism lives here: a route cannot exist without declaring the capability it
 * requires, and `pnpm test:permissions` proves it against **Hono's actual router**.
 *
 * Authoritative documents: `docs/01-architecture/rbac.md` (capabilities and policy kinds) and
 * `docs/01-architecture/adr/0010-route-policy-registry.md`.
 */

export {
  type ApprovedPlugin,
  BETTER_AUTH_PLUGINS,
  checkPluginList,
  formatPluginListReport,
  type PluginListBaseline,
  type PluginListResult,
  type PluginVerdict,
} from "./better-auth-plugins";
export {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  CAPABILITY_NAMES,
  CAPABILITY_TIERS,
  type Capability,
  type CapabilityDefinition,
  type CapabilityGroup,
  type CapabilityTier,
  capabilitiesInGroup,
  capabilityTier,
  type ImpliedCapability,
  isCapability,
  isCapabilityTier,
  isInstanceCapability,
  isWorkspaceTierCapability,
  tierPermits,
} from "./capabilities";
export {
  AUTHORITY_GRANTING,
  type ElevatedAction,
  type ElevationViolation,
  elevatedActions,
  elevatedWithoutSessionOnly,
  elevationViolations,
  isInstanceRoute,
  renderElevatedActionsMarkdown,
  sessionOnlyRoutes,
} from "./elevated";
export {
  authorityFor,
  type CapabilityExpansionOptions,
  can,
  evaluatePolicy,
  expandCapabilities,
  type InstanceScope,
  instanceScope,
  isResolvedScope,
  NO_PERSON_PARAMETER,
  NO_SINGLE_RESOURCE,
  type NoPersonParameter,
  type NoSingleResource,
  organisationScopeFromRequest,
  organisationScopeFromRow,
  type PolicyContext,
  type PolicyDecision,
  type ProjectReachFacts,
  projectScopeFromRequest,
  projectScopeFromRow,
  type RequestScope,
  type ResolvedScope,
  type RowScope,
  reaches,
  ScopeResolutionError,
  scopeIdFor,
  workItemScopeFromRequest,
  workItemScopeFromRow,
  workspaceScopeFromRequest,
  workspaceScopeFromRow,
} from "./evaluator";
export {
  CREDENTIAL_KINDS,
  type CredentialKind,
  type Membership,
  type Portal,
  type Reach,
  type RefusedCapabilityHandler,
  type ResolvedIdentity,
  type RoleGrant,
  type ScopeTarget,
  type Side,
  type UnknownCapabilityHandler,
} from "./identity";
/**
 * kaneo's inherited better-auth access control, re-exported unchanged so the consumers that
 * still read it keep building while #6 removes the `organization` plugin. New code uses the
 * capability and policy surface above. See `legacy-better-auth-access-control.ts`.
 */
export {
  ac,
  admin,
  type BuiltInRoleName,
  builtInRoles,
  DEFAULT_ROLE_NAMES,
  type DefaultRoleName,
  defaultRolePayloads,
  member,
  owner,
  statement,
  viewer,
} from "./legacy-better-auth-access-control";
export {
  BODY_PREDICATES,
  type BodyPredicate,
  type CapabilityPolicy,
  DELEGATED_SURFACES,
  type DelegatedPolicy,
  type DelegatedSurface,
  type ElevationFlags,
  HTTP_METHODS,
  type HttpMethod,
  isCapabilityPolicy,
  isDelegatedPolicy,
  isPortalPolicy,
  isPublicPolicy,
  isSelfPolicy,
  normaliseRouteKey,
  normaliseRoutePath,
  OWNER_PREDICATES,
  type OwnerBranch,
  type OwnerPredicate,
  type PersonParam,
  POLICY_KINDS,
  PORTAL_PREDICATES,
  type Policy,
  type PolicyKind,
  type PolicyMap,
  type PortalPolicy,
  type PortalPredicate,
  type PublicElevationFlags,
  type PublicPolicy,
  policyKind,
  type ReachRequirement,
  type RouteKey,
  routeKeyParts,
  SCOPE_SOURCES,
  SCOPES,
  type Scope,
  type ScopeSource,
  type SelfPolicy,
  type SelfTargetBranch,
} from "./policy";
export {
  capabilitiesReferencedBy,
  createPolicyRegistry,
  type PolicyRegistry,
  PolicyRegistryError,
  type PolicySource,
  type RegistryEntry,
  validatePolicy,
} from "./registry";
export {
  assertRoleComposition,
  BUILT_IN_ROLE_KEYS,
  BUILT_IN_ROLES,
  type BuiltInRoleKey,
  INHERITED_ROLE_KEYS,
  ROLE_SCOPES,
  RoleCompositionError,
  type RoleCompositionProblem,
  type RoleDefinition,
  type RoleScope,
  roleCompositionProblems,
  roleScopeTier,
} from "./roles";
export {
  type CollectedRoute,
  type CoverageBaseline,
  type CoverageResult,
  classifySurface,
  collectMiddleware,
  collectRoutes,
  computeRouteCoverage,
  formatCoverageReport,
  type HonoLikeApp,
  type HonoRouterEntry,
  isMiddlewareEntry,
  ROUTE_SURFACES,
  type RouteSurface,
} from "./route-coverage";
