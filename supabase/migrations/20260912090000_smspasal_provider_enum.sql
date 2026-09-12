-- SMSPasal, part 1 of 2: the enum value.
--
-- Alone in its own migration because Postgres refuses to use a value added to
-- an enum by the same transaction that added it. Part 2 writes the request
-- builder and the response reader that name it.

alter type public.notification_provider add value if not exists 'smspasal_sms';
