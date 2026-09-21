-- The sidebar was calling every gym "Lord of Gyms".
--
-- The line under the gym name in the sidebar was a literal typed into the
-- component. Harmless while one gym ran the software; wrong the moment a
-- second one signs up, and wrong already for this one, whose registered name
-- is set in Settings and never appeared anywhere but the printed letterhead.
--
-- orgs.legal_name is where that name already lives, so the sidebar needs it in
-- the one row it is handed at request time. current_staff() is that row: it is
-- read before tenant claims exist, which is why the sidebar cannot read orgs
-- itself under RLS.
--
-- The return type gains a column, so this is a drop and recreate rather than a
-- replace. The body is otherwise unchanged.

drop function if exists public.current_staff();

create function public.current_staff()
returns table (
  staff_id uuid,
  org_id uuid,
  org_name text,
  org_legal_name text,
  full_name text,
  email text,
  role public.staff_role,
  branch_ids uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select st.id, st.org_id, o.name, o.legal_name, st.full_name, st.email, st.role,
         case
           when st.role = 'owner'::public.staff_role
             then array(select b.id from public.branches b where b.org_id = st.org_id)
           else st.branch_ids
         end
  from public.staff st
  join public.orgs o on o.id = st.org_id
  where st.auth_user_id = auth.uid()
    and st.status = 'active'::public.staff_status;
$$;

revoke execute on function public.current_staff() from public, anon;
grant execute on function public.current_staff() to authenticated;

comment on function public.current_staff() is
  'The signed-in staff member and their org, readable before tenant claims exist. Carries the registered name so the shell can show it beside the trading name.';
