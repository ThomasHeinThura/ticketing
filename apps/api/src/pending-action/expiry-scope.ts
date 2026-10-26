/** Fixed SQL inventory of instance actions with a defined expiry/event contract. */
export const instancePendingActionExpiryPredicate = `project_id IS NULL AND (
  (organisation_id IS NULL AND (
    (action = 'delete' AND target_type = 'user' AND route_key = 'POST /api/instance/users/{id}/deactivate') OR
    (action = 'user_deactivation' AND target_type = 'person' AND route_key = 'POST /api/instance/users/{id}/deactivate') OR
    (action = 'delete' AND target_type = 'identity_connection' AND route_key = 'DELETE /api/instance/identity-connections/{id}' AND cardinality(target_ids) = 1)
  )) OR
  (organisation_id IS NOT NULL AND organisation_id = target_ids[1] AND cardinality(target_ids) = 1 AND target_type = 'organisation' AND (
    (action = 'delete' AND route_key = 'DELETE /api/instance/organisations/{id}') OR
    (action = 'purge' AND route_key = 'POST /api/instance/purge')
  ))
)`;
