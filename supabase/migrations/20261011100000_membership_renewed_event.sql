-- A new event value cannot be used in the transaction that adds it, so the
-- rule, template and trigger that use it ship in the next migration.
alter type public.notification_event add value if not exists 'membership_renewed';
