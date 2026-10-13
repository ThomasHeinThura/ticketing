ALTER TABLE "step_up_confirmation" DROP CONSTRAINT "step_up_operation_route";--> statement-breakpoint
ALTER TABLE "step_up_confirmation" ADD CONSTRAINT "step_up_operation_route" CHECK ("step_up_confirmation"."operation_key" is null
        or ("step_up_confirmation"."operation_key" = 'metrics_token_rotate' and "step_up_confirmation"."route_key" = 'POST /api/instance/observability/metrics-token/rotate')
        or ("step_up_confirmation"."operation_key" = 'identity_connection_create' and "step_up_confirmation"."route_key" = 'POST /api/instance/identity-connections')
        or ("step_up_confirmation"."operation_key" = 'identity_connection_configure' and "step_up_confirmation"."route_key" = 'PATCH /api/instance/identity-connections/{id}')
        or ("step_up_confirmation"."operation_key" = 'oidc_group_mapping_create' and "step_up_confirmation"."route_key" = 'POST /api/instance/identity-connections/{id}/oidc-group-mappings')
        or ("step_up_confirmation"."operation_key" = 'oidc_group_mapping_update' and "step_up_confirmation"."route_key" = 'PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}')
        or ("step_up_confirmation"."operation_key" = 'scim_admin_update' and "step_up_confirmation"."route_key" = 'PATCH /api/instance/identity-connections/{id}/scim')
        or ("step_up_confirmation"."operation_key" = 'scim_token_rotate' and "step_up_confirmation"."route_key" = 'POST /api/instance/identity-connections/{id}/scim/rotate-token')
        or ("step_up_confirmation"."operation_key" = 'scim_token_revoke' and "step_up_confirmation"."route_key" = 'POST /api/instance/identity-connections/{id}/scim/revoke-token')
        or ("step_up_confirmation"."operation_key" = 'mfa_reset' and "step_up_confirmation"."route_key" = 'POST /api/instance/users/{id}/reset-mfa')
        or ("step_up_confirmation"."operation_key" = 'instance_admin_grant' and "step_up_confirmation"."route_key" = 'POST /api/instance/users/{id}/grant-admin'));
