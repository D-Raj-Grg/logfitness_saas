-- Two more reasons a gym texts somebody: the walk-in.
--
-- Phase 5's events are all about a member -- a membership ending, money owed,
-- a birthday. The person who walked in on Tuesday, asked what a month costs
-- and left is in `visitors` and has never been texted by this product at all,
-- which is the one message a gym actually asks for first: "thanks for coming
-- in".
--
--   visitor_welcome    the moment the desk logs the visit.
--   visitor_follow_up  a few days later, if they still have not joined.
--
-- Own migration, own transaction, for the same reason
-- 20260912094000_custom_message_event.sql is one: Postgres refuses to use an
-- enum value inside the transaction that added it, and the next migration
-- writes both of these into rules, templates and function bodies.

alter type public.notification_event add value if not exists 'visitor_welcome';
alter type public.notification_event add value if not exists 'visitor_follow_up';
