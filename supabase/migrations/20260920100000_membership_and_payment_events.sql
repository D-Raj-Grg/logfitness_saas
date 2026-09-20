-- Three more reasons a gym texts somebody: the join, the payment, and the
-- moment the debt is gone.
--
-- Phase 5's events all chase something that has not happened yet -- a
-- membership about to end, money still owed. These three are the opposite:
-- they acknowledge something that just did. A gym that only ever texts to ask
-- for money is a gym whose members stop reading the texts.
--
--   member_welcome    the first membership a member buys.
--   payment_received  every payment handed over, refunds excluded.
--   dues_cleared      an invoice reaching a zero balance.
--
-- `payment_received` and `dues_cleared` are two events rather than one because
-- they answer two different questions. The receipt says "we have your money";
-- the clearance says "you owe us nothing". On a partial payment only the first
-- is true, and on the last instalment an owner may want both or either.
--
-- Own migration, own transaction: Postgres refuses to use an enum value inside
-- the transaction that added it, and the next migration writes all three into
-- rules, templates and function bodies.

alter type public.notification_event add value if not exists 'member_welcome';
alter type public.notification_event add value if not exists 'payment_received';
alter type public.notification_event add value if not exists 'dues_cleared';
