ALTER TABLE "scim_connection" ADD COLUMN "match_attributes" text[] DEFAULT ARRAY['externalId', 'userName']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "scim_connection" ADD CONSTRAINT "scim_connection_match_attributes_check" CHECK (array_lower("scim_connection"."match_attributes", 1) = 1
        and "scim_connection"."match_attributes"[1:2] = ARRAY['externalId', 'userName']::text[]
        and "scim_connection"."match_attributes" <@ ARRAY['externalId', 'userName', 'displayName', 'name.formatted', 'title', 'preferredLanguage']::text[]
        and cardinality(array_positions("scim_connection"."match_attributes", 'displayName')) <= 1
        and cardinality(array_positions("scim_connection"."match_attributes", 'name.formatted')) <= 1
        and cardinality(array_positions("scim_connection"."match_attributes", 'title')) <= 1
        and cardinality(array_positions("scim_connection"."match_attributes", 'preferredLanguage')) <= 1
        and (array_position("scim_connection"."match_attributes", 'displayName') is null or array_position("scim_connection"."match_attributes", 'name.formatted') is null or array_position("scim_connection"."match_attributes", 'displayName') < array_position("scim_connection"."match_attributes", 'name.formatted'))
        and (array_position("scim_connection"."match_attributes", 'name.formatted') is null or array_position("scim_connection"."match_attributes", 'title') is null or array_position("scim_connection"."match_attributes", 'name.formatted') < array_position("scim_connection"."match_attributes", 'title'))
        and (array_position("scim_connection"."match_attributes", 'title') is null or array_position("scim_connection"."match_attributes", 'preferredLanguage') is null or array_position("scim_connection"."match_attributes", 'title') < array_position("scim_connection"."match_attributes", 'preferredLanguage')));