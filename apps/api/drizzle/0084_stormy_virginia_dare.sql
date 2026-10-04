CREATE TABLE "step_up_confirmation" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"session_id" text NOT NULL,
	"binding_kind" text NOT NULL,
	"pending_action_id" text,
	"operation_key" text,
	"route_key" text,
	"expected_version" integer,
	"body_hash" "bytea",
	"challenge_nonce_hash" "bytea" NOT NULL,
	"state" text NOT NULL,
	"token_hash" "bytea",
	"auth_method" text,
	"authenticated_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"challenge_expires_at" timestamp with time zone NOT NULL,
	"token_expires_at" timestamp with time zone,
	CONSTRAINT "step_up_binding_shape" CHECK (("step_up_confirmation"."binding_kind" = 'pending_action' and "step_up_confirmation"."pending_action_id" is not null
          and "step_up_confirmation"."operation_key" is null and "step_up_confirmation"."route_key" is null
          and "step_up_confirmation"."expected_version" is null and "step_up_confirmation"."body_hash" is null)
        or ("step_up_confirmation"."binding_kind" = 'operation' and "step_up_confirmation"."pending_action_id" is null
          and "step_up_confirmation"."operation_key" is not null and "step_up_confirmation"."route_key" is not null
          and "step_up_confirmation"."expected_version" is not null and "step_up_confirmation"."expected_version" >= 1
          and "step_up_confirmation"."body_hash" is not null and octet_length("step_up_confirmation"."body_hash") = 32)),
	CONSTRAINT "step_up_operation_route" CHECK ("step_up_confirmation"."operation_key" is null
        or ("step_up_confirmation"."operation_key" = 'metrics_token_rotate' and "step_up_confirmation"."route_key" = 'POST /api/instance/observability/metrics-token/rotate')
        or ("step_up_confirmation"."operation_key" = 'oidc_group_mapping_create' and "step_up_confirmation"."route_key" = 'POST /api/instance/identity-connections/{id}/oidc-group-mappings')
        or ("step_up_confirmation"."operation_key" = 'oidc_group_mapping_update' and "step_up_confirmation"."route_key" = 'PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}')),
	CONSTRAINT "step_up_state_shape" CHECK (("step_up_confirmation"."state" = 'challenge' and "step_up_confirmation"."token_hash" is null and "step_up_confirmation"."auth_method" is null and "step_up_confirmation"."authenticated_at" is null and "step_up_confirmation"."issued_at" is null and "step_up_confirmation"."consumed_at" is null and "step_up_confirmation"."token_expires_at" is null)
        or ("step_up_confirmation"."state" = 'issued' and "step_up_confirmation"."token_hash" is not null and octet_length("step_up_confirmation"."token_hash") = 32 and "step_up_confirmation"."auth_method" is not null and "step_up_confirmation"."auth_method" in ('password','totp','backup_code','sso_prompt_login') and "step_up_confirmation"."authenticated_at" is not null and "step_up_confirmation"."issued_at" is not null and "step_up_confirmation"."consumed_at" is null and "step_up_confirmation"."token_expires_at" is not null)
        or ("step_up_confirmation"."state" = 'consumed' and "step_up_confirmation"."token_hash" is not null and octet_length("step_up_confirmation"."token_hash") = 32 and "step_up_confirmation"."auth_method" is not null and "step_up_confirmation"."auth_method" in ('password','totp','backup_code','sso_prompt_login') and "step_up_confirmation"."authenticated_at" is not null and "step_up_confirmation"."issued_at" is not null and "step_up_confirmation"."consumed_at" is not null and "step_up_confirmation"."token_expires_at" is not null)),
	CONSTRAINT "step_up_nonce_hash_length" CHECK (octet_length("step_up_confirmation"."challenge_nonce_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp,
	CONSTRAINT "two_factor_failed_count_nonnegative" CHECK ("two_factor"."failed_verification_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "instance_setting" ADD COLUMN "local_factor_policy" jsonb DEFAULT '{"mode":"optional","requiredRoleId":null}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_setting" ADD COLUMN "observability_log_levels" jsonb DEFAULT '{"default":"info","modules":{}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_setting" ADD COLUMN "observability_config_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_setting" ADD COLUMN "metrics_token_hash" "bytea";--> statement-breakpoint
ALTER TABLE "instance_setting" ADD COLUMN "metrics_token_rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "step_up_confirmation" ADD CONSTRAINT "step_up_confirmation_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_up_confirmation" ADD CONSTRAINT "step_up_confirmation_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_up_confirmation" ADD CONSTRAINT "step_up_confirmation_pending_action_id_pending_action_id_fk" FOREIGN KEY ("pending_action_id") REFERENCES "public"."pending_action"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "step_up_session_state_expiry_idx" ON "step_up_confirmation" USING btree ("session_id","state","challenge_expires_at","token_expires_at");--> statement-breakpoint
CREATE INDEX "step_up_pending_action_state_idx" ON "step_up_confirmation" USING btree ("pending_action_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "step_up_token_hash_unique" ON "step_up_confirmation" USING btree ("token_hash") WHERE "step_up_confirmation"."token_hash" is not null;--> statement-breakpoint
CREATE INDEX "two_factor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "two_factor_user_id_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_user_id_unique" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_observability_version_positive" CHECK ("instance_setting"."observability_config_version" >= 1);--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_metrics_token_pair" CHECK (("instance_setting"."metrics_token_hash" is null) = ("instance_setting"."metrics_token_rotated_at" is null));--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_metrics_token_hash_length" CHECK ("instance_setting"."metrics_token_hash" is null or octet_length("instance_setting"."metrics_token_hash") = 32);--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_local_factor_policy_shape" CHECK (jsonb_typeof("instance_setting"."local_factor_policy") = 'object'
        and "instance_setting"."local_factor_policy" ?& array['mode', 'requiredRoleId']
        and ("instance_setting"."local_factor_policy" - array['mode', 'requiredRoleId']::text[]) = '{}'::jsonb
        and "instance_setting"."local_factor_policy"->>'mode' in ('off', 'optional', 'required_staff', 'required_role', 'required_everyone')
        and ((("instance_setting"."local_factor_policy"->>'mode') = 'required_role' and jsonb_typeof("instance_setting"."local_factor_policy"->'requiredRoleId') = 'string')
          or (("instance_setting"."local_factor_policy"->>'mode') <> 'required_role' and jsonb_typeof("instance_setting"."local_factor_policy"->'requiredRoleId') = 'null')));