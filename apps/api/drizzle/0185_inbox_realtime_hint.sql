-- Inbox hints are delivered by PostgreSQL only after the inserting transaction commits.
-- Every HTTP replica listens and invalidates only its own authorized user connections.
-- No content, event arguments, resource identifiers or tenant information is published.
CREATE FUNCTION public.taskdesk_notify_inbox_created() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_catalog.pg_notify('taskdesk_inbox_created', pg_catalog.json_build_object('userId', NEW.user_id)::text);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER taskdesk_inbox_created AFTER INSERT ON public.notification
FOR EACH ROW EXECUTE FUNCTION public.taskdesk_notify_inbox_created();
