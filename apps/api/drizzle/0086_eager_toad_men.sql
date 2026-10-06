ALTER TABLE "instance_setting" DROP CONSTRAINT "instance_setting_observability_log_levels_shape";--> statement-breakpoint
ALTER TABLE "step_up_confirmation" DROP CONSTRAINT "step_up_operation_route";--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_observability_log_levels_shape" CHECK (case
        when jsonb_typeof("instance_setting"."observability_log_levels") = 'object' then
          ("instance_setting"."observability_log_levels" ?& array['default', 'modules'])
          and (("instance_setting"."observability_log_levels" - array['default', 'modules']::text[]) = '{}'::jsonb)
          and jsonb_typeof("instance_setting"."observability_log_levels"->'default') = 'string'
          and "instance_setting"."observability_log_levels"->>'default' in ('error', 'warn', 'info', 'debug')
          and jsonb_typeof("instance_setting"."observability_log_levels"->'modules') = 'object'
          and not ((("instance_setting"."observability_log_levels"->'modules') - array['http', 'auth', 'database', 'jobs', 'audit', 'plugins']::text[]) <> '{}'::jsonb)
          and not jsonb_path_exists("instance_setting"."observability_log_levels", '$.modules.* ? (@ != "error" && @ != "warn" && @ != "info" && @ != "debug")')
        else false
      end);--> statement-breakpoint
ALTER TABLE "step_up_confirmation" ADD CONSTRAINT "step_up_operation_route" CHECK ("step_up_confirmation"."operation_key" is null
        or ("step_up_confirmation"."operation_key" = 'metrics_token_rotate' and "step_up_confirmation"."route_key" = 'POST /api/instance/observability/metrics-token/rotate')
        or ("step_up_confirmation"."operation_key" = 'oidc_group_mapping_create' and "step_up_confirmation"."route_key" = 'POST /api/instance/identity-connections/{id}/oidc-group-mappings')
        or ("step_up_confirmation"."operation_key" = 'oidc_group_mapping_update' and "step_up_confirmation"."route_key" = 'PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}')
        or ("step_up_confirmation"."operation_key" = 'mfa_reset' and "step_up_confirmation"."route_key" = 'POST /api/instance/users/{id}/reset-mfa'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_required_factor_role_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_policy jsonb;
BEGIN
  -- A role DELETE has already acquired its role-row lock before this trigger runs. Policy
  -- writes that target a role acquire that row lock before the singleton lock as well.
  SELECT local_factor_policy INTO current_policy
    FROM instance_setting WHERE id = 'singleton' FOR UPDATE;
  IF current_policy->>'mode' = 'required_role'
     AND current_policy->>'requiredRoleId' = OLD.id THEN
    RAISE EXCEPTION 'role is required by instance local-factor policy'
      USING ERRCODE = '23503', CONSTRAINT = 'role_required_by_local_factor_policy';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER role_required_by_local_factor_policy
  BEFORE DELETE ON role
  FOR EACH ROW EXECUTE FUNCTION prevent_required_factor_role_delete();
