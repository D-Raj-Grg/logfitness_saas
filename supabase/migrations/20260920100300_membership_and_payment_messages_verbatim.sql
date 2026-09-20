-- No behaviour change. `20260920100100` was applied from a copy with the
-- inline comments stripped, so `pg_get_functiondef` and the checked-in
-- migration disagreed on everything except the code. This re-applies the three
-- trigger bodies exactly as the repository holds them, so the database is
-- readable on its own terms. Verified beforehand: comment-stripped, the
-- deployed bodies and these were byte-identical.

create or replace function public.enqueue_member_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  tpl record;
  v_vars jsonb;
  v_address text;
  v_body text;
begin
  begin
    -- Their second plan, or later. Nothing to welcome.
    if exists (
      select 1 from public.memberships m2
      where m2.member_id = new.member_id
        and m2.org_id = new.org_id
        and m2.id <> new.id
    ) then
      return new;
    end if;

    if not public.member_is_contactable(new.member_id) then
      return new;
    end if;

    select
      o.id as org_id, o.name as org_name,
      b.name as branch_name,
      m.full_name, m.phone, m.email,
      rule.channel
      into r
      from public.notification_rules rule
      join public.orgs o on o.id = rule.org_id
      join public.members m on m.id = new.member_id and m.org_id = o.id
      left join public.branches b on b.id = new.branch_id and b.org_id = o.id
     where rule.org_id = new.org_id
       and rule.event = 'member_welcome'::public.notification_event
       and rule.enabled
     limit 1;

    -- No rule, or the owner has it switched off.
    if not found then
      return new;
    end if;

    -- An org with no gateway is skipped entirely rather than accumulating
    -- "there is no gateway" rows, exactly as the sweeps do.
    if not exists (
      select 1 from public.notification_providers np
      where np.org_id = r.org_id and np.channel = r.channel and np.is_active
    ) then
      return new;
    end if;

    v_vars := jsonb_build_object(
      'member_name', r.full_name,
      'name',        r.full_name,
      'gym_name',    r.org_name,
      'branch_name', coalesce(r.branch_name, r.org_name),
      'plan_name',   new.plan_name,
      'start_date',  to_char(new.start_date, 'DD Mon YYYY'),
      'end_date',    coalesce(to_char(new.end_date, 'DD Mon YYYY'), ''),
      'email',       coalesce(r.email, '')
    );

    select * into tpl
      from public.resolve_notification_template(
        r.org_id, 'member_welcome'::public.notification_event, r.channel,
        public.org_notification_locale(r.org_id));

    v_body := public.render_notification_template(tpl.body, v_vars);
    if v_body is null or length(btrim(v_body)) = 0 then
      return new;
    end if;

    v_address := case r.channel
                   when 'email' then lower(nullif(btrim(r.email), ''))
                   else public.normalise_msisdn(r.phone)
                 end;

    insert into public.notification_messages (
      org_id, branch_id, member_id, channel, event, to_address, subject, body,
      status, last_error, dedupe_key
    )
    values (
      r.org_id, new.branch_id, new.member_id, r.channel, 'member_welcome',
      coalesce(v_address, btrim(coalesce(r.phone, 'unknown'))),
      public.render_notification_template(tpl.subject, v_vars),
      left(btrim(v_body), 1000),
      -- A number that will not normalise still gets a row, the sweeps' habit:
      -- the desk mistyped a digit and the log is where that becomes visible.
      case when v_address is null then 'skipped'::public.notification_status
           else 'queued'::public.notification_status end,
      case when v_address is null
           then 'No usable ' || r.channel::text || ' address for this member' end,
      -- Keyed on the member, not the membership: one welcome per person, even
      -- if the first sale is voided and re-entered.
      'member_welcome:' || new.member_id::text
    )
    on conflict (org_id, dedupe_key) do nothing;
  exception
    when others then
      -- Logged, not raised. The membership is sold either way.
      raise warning 'member welcome not queued for %: %', new.member_id, sqlerrm;
  end;

  return new;
end;
$$;

create or replace function public.enqueue_payment_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  tpl record;
  v_vars jsonb;
  v_address text;
  v_body text;
begin
  begin
    if new.kind <> 'payment'::public.payment_kind then
      return new;
    end if;

    if not public.member_is_contactable(new.member_id) then
      return new;
    end if;

    select
      o.id as org_id, o.name as org_name, o.currency, o.timezone,
      b.name as branch_name,
      m.full_name, m.phone, m.email,
      i.invoice_no, i.due_paisa,
      rule.channel
      into r
      from public.notification_rules rule
      join public.orgs o on o.id = rule.org_id
      join public.members m on m.id = new.member_id and m.org_id = o.id
      left join public.branches b on b.id = new.branch_id and b.org_id = o.id
      left join public.invoices i on i.id = new.invoice_id and i.org_id = o.id
     where rule.org_id = new.org_id
       and rule.event = 'payment_received'::public.notification_event
       and rule.enabled
       -- The owner's floor: a Rs 50 top-up need not cost an SMS.
       and new.amount_paisa >= rule.min_amount_paisa
     limit 1;

    if not found then
      return new;
    end if;

    if not exists (
      select 1 from public.notification_providers np
      where np.org_id = r.org_id and np.channel = r.channel and np.is_active
    ) then
      return new;
    end if;

    v_vars := jsonb_build_object(
      'member_name', r.full_name,
      'name',        r.full_name,
      'gym_name',    r.org_name,
      'branch_name', coalesce(r.branch_name, r.org_name),
      'amount',      public.format_paisa(new.amount_paisa, coalesce(r.currency, 'NPR')),
      'due_amount',  public.format_paisa(greatest(coalesce(r.due_paisa, 0), 0),
                                         coalesce(r.currency, 'NPR')),
      'invoice_no',  coalesce(r.invoice_no, ''),
      'paid_on',     to_char(new.paid_at at time zone coalesce(r.timezone, 'UTC'), 'DD Mon YYYY'),
      'email',       coalesce(r.email, '')
    );

    select * into tpl
      from public.resolve_notification_template(
        r.org_id, 'payment_received'::public.notification_event, r.channel,
        public.org_notification_locale(r.org_id));

    v_body := public.render_notification_template(tpl.body, v_vars);
    if v_body is null or length(btrim(v_body)) = 0 then
      return new;
    end if;

    v_address := case r.channel
                   when 'email' then lower(nullif(btrim(r.email), ''))
                   else public.normalise_msisdn(r.phone)
                 end;

    insert into public.notification_messages (
      org_id, branch_id, member_id, channel, event, to_address, subject, body,
      status, last_error, dedupe_key
    )
    values (
      r.org_id, new.branch_id, new.member_id, r.channel, 'payment_received',
      coalesce(v_address, btrim(coalesce(r.phone, 'unknown'))),
      public.render_notification_template(tpl.subject, v_vars),
      left(btrim(v_body), 1000),
      case when v_address is null then 'skipped'::public.notification_status
           else 'queued'::public.notification_status end,
      case when v_address is null
           then 'No usable ' || r.channel::text || ' address for this member' end,
      'payment_received:' || new.id::text
    )
    on conflict (org_id, dedupe_key) do nothing;
  exception
    when others then
      -- Logged, not raised. The cash is recorded either way, and a receipt
      -- that failed to queue must never cost the gym the payment row.
      raise warning 'payment receipt not queued for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

create or replace function public.enqueue_dues_cleared()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  tpl record;
  v_vars jsonb;
  v_address text;
  v_body text;
begin
  begin
    if new.status <> 'paid'::public.invoice_status
       or old.status = 'paid'::public.invoice_status
       or new.total_paisa <= 0 then
      return new;
    end if;

    if not public.member_is_contactable(new.member_id) then
      return new;
    end if;

    -- Still owing on something else. "Nothing is outstanding" would be a lie,
    -- so the message waits for the invoice that actually finishes it.
    if exists (
      select 1 from public.invoices i
      where i.member_id = new.member_id
        and i.org_id = new.org_id
        and i.id <> new.id
        and i.status in ('unpaid'::public.invoice_status,
                         'partial'::public.invoice_status)
        and i.due_paisa > 0
    ) then
      return new;
    end if;

    select
      o.id as org_id, o.name as org_name, o.currency,
      b.name as branch_name,
      m.full_name, m.phone, m.email,
      rule.channel
      into r
      from public.notification_rules rule
      join public.orgs o on o.id = rule.org_id
      join public.members m on m.id = new.member_id and m.org_id = o.id
      left join public.branches b on b.id = new.branch_id and b.org_id = o.id
     where rule.org_id = new.org_id
       and rule.event = 'dues_cleared'::public.notification_event
       and rule.enabled
     limit 1;

    if not found then
      return new;
    end if;

    if not exists (
      select 1 from public.notification_providers np
      where np.org_id = r.org_id and np.channel = r.channel and np.is_active
    ) then
      return new;
    end if;

    v_vars := jsonb_build_object(
      'member_name', r.full_name,
      'name',        r.full_name,
      'gym_name',    r.org_name,
      'branch_name', coalesce(r.branch_name, r.org_name),
      'invoice_no',  new.invoice_no,
      'amount',      public.format_paisa(new.total_paisa, coalesce(r.currency, 'NPR')),
      'email',       coalesce(r.email, '')
    );

    select * into tpl
      from public.resolve_notification_template(
        r.org_id, 'dues_cleared'::public.notification_event, r.channel,
        public.org_notification_locale(r.org_id));

    v_body := public.render_notification_template(tpl.body, v_vars);
    if v_body is null or length(btrim(v_body)) = 0 then
      return new;
    end if;

    v_address := case r.channel
                   when 'email' then lower(nullif(btrim(r.email), ''))
                   else public.normalise_msisdn(r.phone)
                 end;

    insert into public.notification_messages (
      org_id, branch_id, member_id, channel, event, to_address, subject, body,
      status, last_error, dedupe_key
    )
    values (
      r.org_id, new.branch_id, new.member_id, r.channel, 'dues_cleared',
      coalesce(v_address, btrim(coalesce(r.phone, 'unknown'))),
      public.render_notification_template(tpl.subject, v_vars),
      left(btrim(v_body), 1000),
      case when v_address is null then 'skipped'::public.notification_status
           else 'queued'::public.notification_status end,
      case when v_address is null
           then 'No usable ' || r.channel::text || ' address for this member' end,
      -- Keyed on the invoice alone: a refund that reopens it and a second
      -- payment that closes it again do not send this twice. The receipt for
      -- that second payment already says the money arrived.
      'dues_cleared:' || new.id::text
    )
    on conflict (org_id, dedupe_key) do nothing;
  exception
    when others then
      raise warning 'dues clearance not queued for invoice %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.enqueue_member_welcome() from public, anon, authenticated;
revoke execute on function public.enqueue_payment_received() from public, anon, authenticated;
revoke execute on function public.enqueue_dues_cleared() from public, anon, authenticated;
