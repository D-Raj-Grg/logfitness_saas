-- The welcome greets today's walk-in, not yesterday's paperwork.
--
-- `visited_on` is editable on the form precisely so the desk can log yesterday
-- evening's enquiry this morning -- the trigger fired on that insert too, and
-- the built-in wording says "thanks for visiting ... today". Somebody who came
-- in on Tuesday would have been texted on Thursday, thanking them for a visit
-- they made two days ago, which is the same "three days late" the immediate
-- send exists to avoid.
--
-- The automatic welcome is now the day's own event. A back-dated row is left
-- alone; the desk can still send one by hand from the row menu, which is a
-- decision rather than an accident.

create or replace function public.enqueue_visitor_welcome()
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
    -- Back-dated, so the sentence would be wrong. Nothing queued, nothing said.
    if new.visited_on is distinct from public.org_today(new.org_id) then
      return new;
    end if;

    select
      o.id as org_id, o.name as org_name,
      b.name as branch_name,
      p.name as plan_name,
      rule.channel
      into r
      from public.notification_rules rule
      join public.orgs o on o.id = rule.org_id
      left join public.branches b on b.id = new.branch_id and b.org_id = o.id
      left join public.membership_plans p
             on p.id = new.interested_plan_id and p.org_id = o.id
     where rule.org_id = new.org_id
       and rule.event = 'visitor_welcome'::public.notification_event
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
      'visitor_name', new.full_name,
      'name',         new.full_name,
      'gym_name',     r.org_name,
      'branch_name',  coalesce(r.branch_name, r.org_name),
      'plan_name',    coalesce(r.plan_name, ''),
      'visited_on',   to_char(new.visited_on, 'DD Mon YYYY')
    );

    select * into tpl
      from public.resolve_notification_template(
        r.org_id, 'visitor_welcome'::public.notification_event, r.channel,
        public.org_notification_locale(r.org_id));

    v_body := public.render_notification_template(tpl.body, v_vars);
    if v_body is null or length(btrim(v_body)) = 0 then
      return new;
    end if;

    v_address := case r.channel
                   when 'email' then null
                   else public.normalise_msisdn(new.phone)
                 end;

    insert into public.notification_messages (
      org_id, branch_id, visitor_id, channel, event, to_address, subject, body,
      status, last_error, dedupe_key
    )
    values (
      r.org_id, new.branch_id, new.id, r.channel, 'visitor_welcome',
      case
        when v_address is not null then v_address
        when length(btrim(coalesce(new.phone, ''))) >= 3 then btrim(new.phone)
        else 'unknown'
      end,
      public.render_notification_template(tpl.subject, v_vars),
      left(btrim(v_body), 1000),
      case when v_address is null then 'skipped'::public.notification_status
           else 'queued'::public.notification_status end,
      case when v_address is null
           then 'No usable ' || r.channel::text || ' address for this visitor' end,
      'visitor_welcome:' || new.id::text
    )
    on conflict (org_id, dedupe_key) do nothing;
  exception
    when others then
      raise warning 'visitor welcome not queued for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.enqueue_visitor_welcome() from public, anon, authenticated;

-- PostgREST caches the function signatures it exposes, and
-- `enqueue_notification` was dropped and rebuilt with one more parameter.
notify pgrst, 'reload schema';
