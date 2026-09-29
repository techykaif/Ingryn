-- Enable low-latency scan result updates for the mobile results screen.
DO $$
BEGIN
  IF to_regclass('public.scans') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication p
       JOIN pg_publication_rel pr ON pr.prpubid = p.oid
       JOIN pg_class c ON c.oid = pr.prrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE p.pubname = 'supabase_realtime'
         AND n.nspname = 'public'
         AND c.relname = 'scans'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.scans';
  END IF;
END
$$;
