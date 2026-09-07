-- Phase 5, part 6 of 6: the schedules.
--
-- Two working jobs, not three. The outbox job reaps the previous minute's
-- responses and then dispatches the next batch in one transaction, because
-- pg_cron serialises by job name -- a second instance of a named job is queued,
-- never run concurrently -- so one job is a guaranteed single writer over
-- `notification_messages`. Two separate jobs would contend for the same rows
-- and buy nothing. Reap-before-send also fixes the ordering: each run reaps
-- exactly what the previous run dispatched, so the lag is one minute against a
-- pg_net response TTL of six hours.
--
-- The daily enqueue runs at 20:45 UTC, which is 02:30 in Kathmandu -- thirty
-- minutes after `sweep-membership-expiry`, so every membership status the
-- reminders read has already been recomputed for the new day. A rule whose
-- send_at_local is earlier than 02:30 local therefore goes out the following
-- morning rather than the same one; the default is 09:00 and the settings form
-- says so.
--
-- The schedule is global UTC, as it must be. Per-org date correctness comes
-- from org_today(org_id) inside each function -- the pattern the expiry sweep
-- already set.

select cron.schedule(
  'notifications-enqueue',
  '45 20 * * *',
  $cron$select public.enqueue_notifications();$cron$
);

select cron.schedule(
  'notifications-outbox',
  '* * * * *',
  $cron$select public.reap_notification_responses(200), public.send_notification_batch(50);$cron$
);

-- A job running every minute writes 1,440 rows a day into cron.job_run_details
-- and nothing prunes it by default.
select cron.schedule(
  'prune-cron-job-run-details',
  '0 12 * * *',
  $cron$delete from cron.job_run_details where end_time < now() - interval '7 days'$cron$
);
