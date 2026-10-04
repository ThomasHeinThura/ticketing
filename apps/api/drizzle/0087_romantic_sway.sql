ALTER TABLE "instance_setting" DROP CONSTRAINT "instance_setting_observability_log_levels_shape";--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_observability_log_levels_shape" CHECK (case
        when jsonb_typeof("instance_setting"."observability_log_levels") = 'object' then
          ("instance_setting"."observability_log_levels" ?& array['default', 'modules'])
          and (("instance_setting"."observability_log_levels" - array['default', 'modules']::text[]) = '{}'::jsonb)
          and jsonb_typeof("instance_setting"."observability_log_levels"->'default') = 'string'
          and "instance_setting"."observability_log_levels"->>'default' in ('error', 'warn', 'info', 'debug')
          and jsonb_typeof("instance_setting"."observability_log_levels"->'modules') = 'object'
          and not ((("instance_setting"."observability_log_levels"->'modules') - array['http', 'auth', 'database', 'jobs', 'audit', 'plugins', 'realtime']::text[]) <> '{}'::jsonb)
          and not jsonb_path_exists("instance_setting"."observability_log_levels", '$.modules.* ? (@ != "error" && @ != "warn" && @ != "info" && @ != "debug")')
        else false
      end);