begin;

select plan(16);

select has_table(
  'public',
  'scan_analysis_jobs',
  'scan analysis queue table exists'
);

select has_column(
  'public',
  'scan_analysis_jobs',
  'retry_count',
  'queue tracks consecutive retry failures'
);

select has_column(
  'public',
  'scan_analysis_jobs',
  'attempts',
  'queue retains total claim attempts'
);

select ok(
  (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'scan_analysis_jobs'
  ),
  'queue RLS is enabled'
);

select ok(
  not has_table_privilege('anon', 'public.scan_analysis_jobs', 'SELECT'),
  'anon cannot read the queue'
);

select ok(
  not has_table_privilege('authenticated', 'public.scan_analysis_jobs', 'SELECT'),
  'authenticated cannot read the queue'
);

select ok(
  has_table_privilege('service_role', 'public.scan_analysis_jobs', 'SELECT'),
  'service_role can read the queue'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.claim_scan_analysis_job()',
    'EXECUTE'
  ),
  'anon cannot claim jobs'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_scan_analysis_job()',
    'EXECUTE'
  ),
  'service_role can claim jobs'
);

select has_trigger(
  'public',
  'scans',
  'enqueue_scan_analysis_job_after_insert',
  'pending scans have an enqueue trigger'
);

create temp table scan_analysis_test_ids (
  user_id uuid not null,
  pending_scan_id uuid not null,
  stale_scan_id uuid not null,
  future_scan_id uuid not null
);

insert into scan_analysis_test_ids
select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

insert into auth.users (
  id,
  aud,
  role,
  email
)
select
  user_id,
  'authenticated',
  'authenticated',
  'scan-worker-test-' || user_id::text || '@example.test'
from scan_analysis_test_ids;

insert into public.scans (
  id,
  user_id,
  raw_ocr_text,
  analysis_status
)
select pending_scan_id, user_id, 'sugar, salt', 'processing'
from scan_analysis_test_ids;

insert into public.scans (
  id,
  user_id,
  raw_ocr_text,
  analysis_status
)
select stale_scan_id, user_id, 'sugar, salt', 'processing'
from scan_analysis_test_ids;

insert into public.scans (
  id,
  user_id,
  raw_ocr_text,
  analysis_status
)
select future_scan_id, user_id, 'sugar, salt', 'processing'
from scan_analysis_test_ids;

insert into public.scan_analysis_jobs (
  scan_id,
  status,
  next_attempt_at,
  retry_count
)
select pending_scan_id, 'pending', now(), 0
from scan_analysis_test_ids;

select ok(
  exists (
    select 1
    from public.claim_scan_analysis_job() j
    join scan_analysis_test_ids t on t.pending_scan_id = j.scan_id
  ),
  'pending job is claimable'
);

select is(
  (
    select status
    from public.scan_analysis_jobs j
    join scan_analysis_test_ids t on t.pending_scan_id = j.scan_id
  ),
  'processing'::text,
  'claim moves pending job to processing'
);

select is(
  (
    select attempts
    from public.scan_analysis_jobs j
    join scan_analysis_test_ids t on t.pending_scan_id = j.scan_id
  ),
  1,
  'claim increments total claim attempts'
);

select is(
  (
    select retry_count
    from public.scan_analysis_jobs j
    join scan_analysis_test_ids t on t.pending_scan_id = j.scan_id
  ),
  0,
  'successful claim starts with zero retry failures'
);

update public.scan_analysis_jobs j
set status = 'completed',
    completed_at = now()
from scan_analysis_test_ids t
where j.scan_id = t.pending_scan_id;

insert into public.scan_analysis_jobs (
  scan_id,
  status,
  next_attempt_at,
  locked_at,
  lock_until,
  retry_count
)
select stale_scan_id,
       'processing',
       now(),
       now() - interval '6 minutes',
       now() - interval '1 minute',
       2
from scan_analysis_test_ids;

select ok(
  exists (
    select 1
    from public.claim_scan_analysis_job() j
    join scan_analysis_test_ids t on t.stale_scan_id = j.scan_id
  ),
  'expired processing lease is reclaimable'
);

select is(
  (
    select retry_count
    from public.scan_analysis_jobs j
    join scan_analysis_test_ids t on t.stale_scan_id = j.scan_id
  ),
  2,
  'lease recovery does not invent a retry failure'
);

update public.scan_analysis_jobs j
set status = 'completed',
    completed_at = now()
from scan_analysis_test_ids t
where j.scan_id = t.stale_scan_id;

insert into public.scan_analysis_jobs (
  scan_id,
  status,
  next_attempt_at
)
select future_scan_id, 'pending', now() + interval '1 hour'
from scan_analysis_test_ids;

select is(
  (
    select count(*)
    from public.claim_scan_analysis_job() j
    where j.scan_id = (select future_scan_id from scan_analysis_test_ids)
  ),
  0::bigint,
  'future pending jobs are not claimed early'
);

select * from finish();

rollback;
