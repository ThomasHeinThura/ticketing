-- Custom SQL migration file, put your code below! --
CREATE OR REPLACE FUNCTION enforce_user_bootstrap_admission() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  setup_completed_at timestamp;
  existing_user boolean;
BEGIN
  SELECT setting.setup_completed_at INTO setup_completed_at
    FROM instance_setting AS setting
    WHERE setting.id = 'singleton';

  IF setup_completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Ordinary rows can be seeded/migrated while the first admin is pending;
  -- only the server-authorized bootstrap role claims first-user admission.
  IF NEW.role IS DISTINCT FROM 'admin' THEN
    RETURN NEW;
  END IF;

  -- This is the same transaction-scoped lock used by bootstrap promotion,
  -- verified MFA completion, and the initialized-instance recovery CLI.
  PERFORM pg_advisory_xact_lock(2026);

  -- Re-read after acquiring the lock; another first-user transaction may
  -- have committed while this insert waited.
  SELECT setting.setup_completed_at INTO setup_completed_at
    FROM instance_setting AS setting
    WHERE setting.id = 'singleton';

  IF setup_completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (SELECT 1 FROM "user") INTO existing_user;
  IF existing_user THEN
    RAISE EXCEPTION 'first-user bootstrap admission is closed'
      USING ERRCODE = '23514', CONSTRAINT = 'user_bootstrap_admission';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_bootstrap_admission
  BEFORE INSERT ON "user"
  FOR EACH ROW EXECUTE FUNCTION enforce_user_bootstrap_admission();
