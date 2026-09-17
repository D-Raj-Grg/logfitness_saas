-- The enum value on its own, ahead of everything that uses it.
--
-- Postgres refuses to use a new enum value in the same transaction that added
-- it, so `announcement` cannot be added and then written into a function body
-- or a seeded template in one migration. 20260912100000 split the two visitor
-- events out for the same reason; this is that split again.
--
-- One event rather than one per audience. A gym closing for Vishwakarma Puja
-- tells its members and its walk-ins the same sentence, and the delivery log
-- already says which of the two a row was about through `member_id` and
-- `visitor_id`. A second enum value would only make "how many people were
-- told" a two-part question.

alter type public.notification_event add value if not exists 'announcement';
