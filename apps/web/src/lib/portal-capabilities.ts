/**
 * Portal features whose API ships in a later slice. The shell renders a capability's UI only
 * when it is on, so no page probes an endpoint that does not exist yet.
 *
 * `projects`: `GET /api/portal/projects` (S4c). The top-bar project selector stays hidden
 * until S4c implements the route and turns this on.
 */
export const portalCapabilities = Object.freeze({
  projects: false,
});
