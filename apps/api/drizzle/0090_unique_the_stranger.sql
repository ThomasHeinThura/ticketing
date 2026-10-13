CREATE TABLE "external_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_connection_id" text NOT NULL,
	"person_id" text NOT NULL,
	"user_id" text,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"scim_external_id" text,
	"user_name_snapshot" text,
	"email_snapshot" text,
	"active" boolean DEFAULT true NOT NULL,
	"provisioned_via" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "external_identity_provisioned_via_check" CHECK ("external_identity"."provisioned_via" in ('jit', 'scim', 'invite'))
);
--> statement-breakpoint
CREATE TABLE "identity_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_type" text NOT NULL,
	"portal_scope" text NOT NULL,
	"organisation_id" text,
	"display_name" text NOT NULL,
	"issuer" text NOT NULL,
	"tenant_id" text,
	"client_id" text NOT NULL,
	"client_secret" "bytea" NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" text[] NOT NULL,
	"claim_mapping" jsonb NOT NULL,
	"domain_bindings" text[] DEFAULT '{}'::text[] NOT NULL,
	"jit_policy" jsonb NOT NULL,
	"max_role_rank" integer,
	"mfa_upstream_mode" text DEFAULT 'off' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"health_state" text DEFAULT 'unknown' NOT NULL,
	"health_checked_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_connection_provider_type_check" CHECK ("identity_connection"."provider_type" in ('entra')),
	CONSTRAINT "identity_connection_portal_scope_check" CHECK ("identity_connection"."portal_scope" in ('agent', 'customer')),
	CONSTRAINT "identity_connection_portal_organisation_check" CHECK (("identity_connection"."portal_scope" = 'customer' and "identity_connection"."organisation_id" is not null) or ("identity_connection"."portal_scope" = 'agent' and "identity_connection"."organisation_id" is null)),
	CONSTRAINT "identity_connection_rank_check" CHECK (("identity_connection"."portal_scope" = 'customer' and "identity_connection"."max_role_rank" is null) or ("identity_connection"."portal_scope" = 'agent' and "identity_connection"."max_role_rank" >= 0)),
	CONSTRAINT "identity_connection_config_version_check" CHECK ("identity_connection"."config_version" >= 1),
	CONSTRAINT "identity_connection_mfa_mode_check" CHECK ("identity_connection"."mfa_upstream_mode" in ('claim', 'static', 'off')),
	CONSTRAINT "identity_connection_health_state_check" CHECK ("identity_connection"."health_state" in ('unknown', 'healthy', 'degraded', 'invalid'))
);
--> statement-breakpoint
CREATE TABLE "membership_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text,
	"person_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"role_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"external_identity_id" text,
	"identity_connection_id" text,
	"oidc_group_mapping_id" text,
	"scim_group_mapping_id" text,
	"sees_all" boolean DEFAULT false NOT NULL,
	"direct_origin" text,
	"granted_by_person_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_confirmed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	CONSTRAINT "membership_grant_source_kind_check" CHECK ("membership_grant"."source_kind" in ('direct', 'jit_default', 'oidc_group', 'scim_group')),
	CONSTRAINT "membership_grant_direct_origin_check" CHECK ("membership_grant"."direct_origin" is null or "membership_grant"."direct_origin" in ('admin', 'system_backfill')),
	CONSTRAINT "membership_grant_revocation_reason_check" CHECK ("membership_grant"."revocation_reason" is null or "membership_grant"."revocation_reason" in ('claim_removed', 'claim_missing', 'claim_overage', 'admission_failed', 'mapping_disabled', 'mapping_changed', 'role_deleted', 'connection_disabled', 'scim_group_removed', 'scim_deactivated', 'direct_removed')),
	CONSTRAINT "membership_grant_source_shape_check" CHECK (("membership_grant"."source_kind" = 'direct' and "membership_grant"."direct_origin" is not null and (("membership_grant"."direct_origin" = 'admin' and "membership_grant"."granted_by_person_id" is not null) or ("membership_grant"."direct_origin" = 'system_backfill' and "membership_grant"."granted_by_person_id" is null)) and "membership_grant"."external_identity_id" is null and "membership_grant"."identity_connection_id" is null and "membership_grant"."oidc_group_mapping_id" is null and "membership_grant"."scim_group_mapping_id" is null)
        or ("membership_grant"."source_kind" = 'jit_default' and "membership_grant"."direct_origin" is null and "membership_grant"."granted_by_person_id" is null and "membership_grant"."external_identity_id" is not null and "membership_grant"."identity_connection_id" is not null and "membership_grant"."oidc_group_mapping_id" is null and "membership_grant"."scim_group_mapping_id" is null and "membership_grant"."sees_all" = false)
        or ("membership_grant"."source_kind" = 'oidc_group' and "membership_grant"."direct_origin" is null and "membership_grant"."granted_by_person_id" is null and "membership_grant"."external_identity_id" is not null and "membership_grant"."identity_connection_id" is not null and "membership_grant"."oidc_group_mapping_id" is not null and "membership_grant"."scim_group_mapping_id" is null and "membership_grant"."sees_all" = false)
        or ("membership_grant"."source_kind" = 'scim_group' and "membership_grant"."direct_origin" is null and "membership_grant"."granted_by_person_id" is null and "membership_grant"."external_identity_id" is not null and "membership_grant"."identity_connection_id" is not null and "membership_grant"."oidc_group_mapping_id" is null and "membership_grant"."scim_group_mapping_id" is not null and "membership_grant"."sees_all" = false))
);
--> statement-breakpoint
CREATE TABLE "oidc_group_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_connection_id" text NOT NULL,
	"external_group_id" text NOT NULL,
	"external_group_name_snapshot" text,
	"role_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_group_mapping_connection_group_unique" UNIQUE("identity_connection_id","external_group_id"),
	CONSTRAINT "oidc_group_mapping_scope_check" CHECK ("oidc_group_mapping"."scope" in ('organisation', 'workspace'))
);
--> statement-breakpoint
CREATE TABLE "provisioning_event" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_connection_id" text NOT NULL,
	"scim_connection_id" text,
	"external_identity_id" text,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_type" text NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provisioning_event_kind_check" CHECK ("provisioning_event"."kind" in ('user.created', 'user.updated', 'user.deactivated', 'user.reactivated', 'group.mapping_changed', 'group.member_added', 'group.member_removed', 'request.denied', 'auth.failed', 'token.rotated', 'token.revoked', 'connection.changed', 'sync.failed'))
);
--> statement-breakpoint
CREATE TABLE "scim_connection" (
	"identity_connection_id" text PRIMARY KEY NOT NULL,
	"token_hash" "bytea",
	"token_prefix" text,
	"token_created_at" timestamp with time zone,
	"token_rotated_at" timestamp with time zone,
	"allowed_resources" text[] DEFAULT ARRAY['users']::text[] NOT NULL,
	"attribute_mapping" jsonb,
	"lifecycle_policy" text DEFAULT 'end_memberships' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_outcome" text,
	"last_failure" jsonb,
	CONSTRAINT "scim_connection_token_hash_shape" CHECK ("scim_connection"."token_hash" is null or octet_length("scim_connection"."token_hash") = 32),
	CONSTRAINT "scim_connection_token_pair_shape" CHECK (("scim_connection"."token_hash" is null and "scim_connection"."token_prefix" is null) or ("scim_connection"."token_hash" is not null and "scim_connection"."token_prefix" is not null)),
	CONSTRAINT "scim_connection_allowed_resources_check" CHECK ('users' = any("scim_connection"."allowed_resources") and "scim_connection"."allowed_resources" <@ ARRAY['users', 'groups']::text[]),
	CONSTRAINT "scim_connection_lifecycle_policy_check" CHECK ("scim_connection"."lifecycle_policy" in ('end_memberships', 'keep_memberships'))
);
--> statement-breakpoint
CREATE TABLE "scim_group_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"scim_connection_id" text NOT NULL,
	"external_group_id" text NOT NULL,
	"external_group_name_snapshot" text,
	"role_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scim_group_mapping_connection_group_unique" UNIQUE("scim_connection_id","external_group_id"),
	CONSTRAINT "scim_group_mapping_scope_check" CHECK ("scim_group_mapping"."scope" in ('organisation', 'workspace'))
);
--> statement-breakpoint
CREATE TABLE "scim_group_member" (
	"id" text PRIMARY KEY NOT NULL,
	"scim_group_mapping_id" text NOT NULL,
	"external_identity_id" text NOT NULL,
	"membership_id" text,
	"membership_grant_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "scim_group_member_membership_grant_id_unique" UNIQUE("membership_grant_id")
);
--> statement-breakpoint
ALTER TABLE "external_identity" ADD CONSTRAINT "external_identity_identity_connection_id_identity_connection_id_fk" FOREIGN KEY ("identity_connection_id") REFERENCES "public"."identity_connection"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "external_identity" ADD CONSTRAINT "external_identity_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "external_identity" ADD CONSTRAINT "external_identity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "identity_connection" ADD CONSTRAINT "identity_connection_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "identity_connection" ADD CONSTRAINT "identity_connection_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_connection" ADD CONSTRAINT "identity_connection_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_membership_id_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."membership"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_external_identity_id_external_identity_id_fk" FOREIGN KEY ("external_identity_id") REFERENCES "public"."external_identity"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_identity_connection_id_identity_connection_id_fk" FOREIGN KEY ("identity_connection_id") REFERENCES "public"."identity_connection"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_oidc_group_mapping_id_oidc_group_mapping_id_fk" FOREIGN KEY ("oidc_group_mapping_id") REFERENCES "public"."oidc_group_mapping"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_scim_group_mapping_id_scim_group_mapping_id_fk" FOREIGN KEY ("scim_group_mapping_id") REFERENCES "public"."scim_group_mapping"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_granted_by_person_id_person_id_fk" FOREIGN KEY ("granted_by_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oidc_group_mapping" ADD CONSTRAINT "oidc_group_mapping_identity_connection_id_identity_connection_id_fk" FOREIGN KEY ("identity_connection_id") REFERENCES "public"."identity_connection"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oidc_group_mapping" ADD CONSTRAINT "oidc_group_mapping_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oidc_group_mapping" ADD CONSTRAINT "oidc_group_mapping_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_event" ADD CONSTRAINT "provisioning_event_identity_connection_id_identity_connection_id_fk" FOREIGN KEY ("identity_connection_id") REFERENCES "public"."identity_connection"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "provisioning_event" ADD CONSTRAINT "provisioning_event_scim_connection_id_scim_connection_identity_connection_id_fk" FOREIGN KEY ("scim_connection_id") REFERENCES "public"."scim_connection"("identity_connection_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "provisioning_event" ADD CONSTRAINT "provisioning_event_external_identity_id_external_identity_id_fk" FOREIGN KEY ("external_identity_id") REFERENCES "public"."external_identity"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scim_connection" ADD CONSTRAINT "scim_connection_identity_connection_id_identity_connection_id_fk" FOREIGN KEY ("identity_connection_id") REFERENCES "public"."identity_connection"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scim_group_mapping" ADD CONSTRAINT "scim_group_mapping_scim_connection_id_scim_connection_identity_connection_id_fk" FOREIGN KEY ("scim_connection_id") REFERENCES "public"."scim_connection"("identity_connection_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scim_group_mapping" ADD CONSTRAINT "scim_group_mapping_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scim_group_mapping" ADD CONSTRAINT "scim_group_mapping_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_scim_group_mapping_id_scim_group_mapping_id_fk" FOREIGN KEY ("scim_group_mapping_id") REFERENCES "public"."scim_group_mapping"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_external_identity_id_external_identity_id_fk" FOREIGN KEY ("external_identity_id") REFERENCES "public"."external_identity"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_membership_id_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."membership"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_membership_grant_id_membership_grant_id_fk" FOREIGN KEY ("membership_grant_id") REFERENCES "public"."membership_grant"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "external_identity_connection_subject_unique" ON "external_identity" USING btree ("identity_connection_id","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "external_identity_connection_scim_external_id_unique" ON "external_identity" USING btree ("identity_connection_id","scim_external_id") WHERE "external_identity"."scim_external_id" is not null;--> statement-breakpoint
CREATE INDEX "external_identity_person_active_idx" ON "external_identity" USING btree ("person_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_connection_organisation_unique" ON "identity_connection" USING btree ("organisation_id") WHERE "identity_connection"."organisation_id" is not null;--> statement-breakpoint
CREATE INDEX "identity_connection_portal_enabled_idx" ON "identity_connection" USING btree ("portal_scope","enabled");--> statement-breakpoint
CREATE INDEX "membership_grant_person_scope_idx" ON "membership_grant" USING btree ("person_id","scope","scope_id") WHERE "membership_grant"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_grant_direct_active_unique" ON "membership_grant" USING btree ("person_id","scope","scope_id") WHERE "membership_grant"."revoked_at" is null and "membership_grant"."source_kind" = 'direct';--> statement-breakpoint
CREATE UNIQUE INDEX "membership_grant_jit_active_unique" ON "membership_grant" USING btree ("external_identity_id","scope","scope_id") WHERE "membership_grant"."revoked_at" is null and "membership_grant"."source_kind" = 'jit_default';--> statement-breakpoint
CREATE UNIQUE INDEX "membership_grant_oidc_active_unique" ON "membership_grant" USING btree ("external_identity_id","oidc_group_mapping_id") WHERE "membership_grant"."revoked_at" is null and "membership_grant"."source_kind" = 'oidc_group';--> statement-breakpoint
CREATE UNIQUE INDEX "membership_grant_scim_active_unique" ON "membership_grant" USING btree ("external_identity_id","scim_group_mapping_id") WHERE "membership_grant"."revoked_at" is null and "membership_grant"."source_kind" = 'scim_group';--> statement-breakpoint
CREATE INDEX "membership_grant_connection_active_idx" ON "membership_grant" USING btree ("identity_connection_id") WHERE "membership_grant"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "membership_grant_role_idx" ON "membership_grant" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "oidc_group_mapping_role_idx" ON "oidc_group_mapping" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "provisioning_event_connection_created_idx" ON "provisioning_event" USING btree ("identity_connection_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "provisioning_event_scim_created_idx" ON "provisioning_event" USING btree ("scim_connection_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scim_group_mapping_role_idx" ON "scim_group_mapping" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_group_member_active_unique" ON "scim_group_member" USING btree ("external_identity_id","scim_group_mapping_id") WHERE "scim_group_member"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "scim_group_member_mapping_active_idx" ON "scim_group_member" USING btree ("scim_group_mapping_id","revoked_at");