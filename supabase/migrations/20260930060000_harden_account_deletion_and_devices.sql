-- Production security hardening for account deletion and device tracking.
-- Account deletion is now brokered through the authenticated Edge Function and
-- executed by a service-role-only database function.

CREATE OR REPLACE FUNCTION public.delete_user_account(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  device_row record;
  remaining_accounts integer;
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required';
  END IF;

  -- Remove the user's device links and keep shared device counters accurate.
  FOR device_row IN
    SELECT device_signature
    FROM public.user_devices
    WHERE user_id = target_user_id
  LOOP
    DELETE FROM public.user_devices
    WHERE user_id = target_user_id
      AND device_signature = device_row.device_signature;

    SELECT count(*)
    INTO remaining_accounts
    FROM public.user_devices
    WHERE device_signature = device_row.device_signature;

    IF remaining_accounts = 0 THEN
      DELETE FROM public.device_flags
      WHERE device_signature = device_row.device_signature;

      DELETE FROM public.devices
      WHERE device_signature = device_row.device_signature;
    ELSE
      UPDATE public.devices
      SET
        account_count = remaining_accounts,
        updated_at = timezone('utc', now())
      WHERE device_signature = device_row.device_signature;

      IF remaining_accounts <= 3 THEN
        DELETE FROM public.device_flags
        WHERE device_signature = device_row.device_signature;
      END IF;
    END IF;
  END LOOP;

  -- These tables do not cascade from auth.users and therefore must be cleaned
  -- explicitly before removing the auth account.
  DELETE FROM public.profiles
  WHERE id = target_user_id;

  DELETE FROM public.dietary_preferences
  WHERE user_id = target_user_id;

  DELETE FROM public.scans
  WHERE user_id = target_user_id;

  DELETE FROM auth.users
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;
END;
$function$;

-- This function is an internal database primitive. The mobile client must
-- never be able to call it directly.
REVOKE ALL ON FUNCTION public.delete_user_account(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid)
  TO service_role;

-- Device-tracking tables are server-managed. Keep RLS enabled with no client
-- policies and remove unnecessary Data API table privileges as defense in depth.
REVOKE ALL ON TABLE public.devices, public.user_devices, public.device_flags
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.devices, public.user_devices, public.device_flags
  TO service_role;
