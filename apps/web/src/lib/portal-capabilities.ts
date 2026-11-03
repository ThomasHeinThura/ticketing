/**
 * Portal features whose API ships in a later slice. The shell renders a capability's UI only
 * when it is on, so no page probes an endpoint that does not exist yet.
 *
 * `projects`: `GET /api/portal/projects` (S4c, implemented). The top-bar project selector lists
 * the organisation's projects and sets `?project=KEY`.
 */
export const portalCapabilities = Object.freeze({
  projects: true,
});
