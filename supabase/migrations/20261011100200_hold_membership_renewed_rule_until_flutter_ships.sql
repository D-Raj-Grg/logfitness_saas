-- The shipped Flutter build parses every notification_rules row into a
-- NotificationEvent and throws UnknownEnumValue on one it does not know, so a
-- rule row for membership_renewed breaks its notification settings screen even
-- when disabled. The trigger does nothing without an enabled rule, so removing
-- the rows parks the feature. Re-run seed_notification_rules (restored below
-- with the new line) and enable the LOG Fitness rule once a build carrying the
-- enum is in members' hands.
delete from public.notification_rules where event = 'membership_renewed';

create or replace function public.seed_notification_rules(p_org_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notification_rules (org_id, event, channel, enabled, offset_days, min_amount_paisa, repeat_after_days)
  values
    (p_org_id, 'renewal_reminder',  'sms', true,  7, 0, 7),
    (p_org_id, 'renewal_reminder',  'sms', true,  1, 0, 7),
    (p_org_id, 'dues_reminder',     'sms', true,  3, 0, 7),
    (p_org_id, 'birthday_greeting', 'sms', true,  0, 0, 7),
    (p_org_id, 'visitor_welcome',   'sms', false, 0, 0, 7),
    (p_org_id, 'visitor_follow_up', 'sms', false, 3, 0, 7),
    (p_org_id, 'member_welcome',    'sms', false, 0, 0, 7),
    (p_org_id, 'payment_received',  'sms', false, 0, 0, 7),
    (p_org_id, 'dues_cleared',      'sms', false, 0, 0, 7)
  on conflict (org_id, event, channel, offset_days) do nothing;
$$;
