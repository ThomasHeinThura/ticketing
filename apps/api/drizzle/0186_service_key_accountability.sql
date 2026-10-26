ALTER TABLE "api_key" ADD COLUMN "admin_ownership_transferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "former_creator_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "reattestation_required_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "reattested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "reattested_by_person_id" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "accountability_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_reattested_by_person_id_person_id_fk" FOREIGN KEY ("reattested_by_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_accountability_version_positive" CHECK (accountability_version >= 1);--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_accountability_service_only" CHECK (workspace_id IS NOT NULL OR (admin_ownership_transferred_at IS NULL AND former_creator_at IS NULL AND reattestation_required_at IS NULL AND reattested_at IS NULL AND reattested_by_person_id IS NULL));
--> statement-breakpoint
-- Existing durable credentials with no live creator transfer accountability, not authority.
UPDATE public.api_key k
SET admin_ownership_transferred_at = CURRENT_TIMESTAMP,
    former_creator_at = CASE WHEN EXISTS (
      SELECT 1 FROM public.person p WHERE p.id = k.created_by_person_id AND p.active = false
    ) THEN CURRENT_TIMESTAMP ELSE NULL END,
    reattestation_required_at = CASE WHEN EXISTS (
      SELECT 1 FROM public.apikey a WHERE a.id = k.apikey_id AND a.enabled = true
    ) THEN CURRENT_TIMESTAMP ELSE NULL END,
    accountability_version = k.accountability_version + 1
WHERE k.workspace_id IS NOT NULL AND (
  k.created_by_person_id IS NULL OR EXISTS (
    SELECT 1 FROM public.person p WHERE p.id = k.created_by_person_id AND p.active IS NOT TRUE
  )
);
--> statement-breakpoint
-- Preserve the transfer history before the creator FK becomes NULL on physical removal.
CREATE FUNCTION public.taskdesk_transfer_removed_creator_keys() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  UPDATE public.api_key k
  SET admin_ownership_transferred_at = COALESCE(k.admin_ownership_transferred_at, CURRENT_TIMESTAMP),
      former_creator_at = COALESCE(k.former_creator_at, CURRENT_TIMESTAMP),
      reattestation_required_at = CASE WHEN EXISTS (
        SELECT 1 FROM public.apikey a WHERE a.id = k.apikey_id AND a.enabled = true
      ) THEN CURRENT_TIMESTAMP ELSE k.reattestation_required_at END,
      accountability_version = k.accountability_version + 1
  WHERE k.workspace_id IS NOT NULL AND k.created_by_person_id = OLD.id;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER taskdesk_removed_creator_service_keys BEFORE DELETE ON public.person
FOR EACH ROW EXECUTE FUNCTION public.taskdesk_transfer_removed_creator_keys();
