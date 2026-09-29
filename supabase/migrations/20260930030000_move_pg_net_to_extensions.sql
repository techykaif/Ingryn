-- pg_net is non-relocatable. Supabase recommends recreating it in the
-- extensions schema when the security advisor reports it in public.
--
-- The pending request queue was verified empty before applying this change.
-- Stored response rows are ephemeral pg_net telemetry and may be discarded.

CREATE SCHEMA IF NOT EXISTS extensions;

DROP EXTENSION IF EXISTS pg_net;

CREATE EXTENSION pg_net WITH SCHEMA extensions;
