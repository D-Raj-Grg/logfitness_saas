-- The refusal message followed the policy: with follow-up now org-wide, a
-- zero-row update is no longer "another branch" -- it is a visitor this caller
-- cannot write at all.
create or replace function public.convert_visitor(
  p_visitor_id uuid,
  p_member_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  visitor public.visitors%rowtype;
  member public.members%rowtype;
begin
  select * into visitor from public.visitors where id = p_visitor_id;
  if not found then
    raise exception 'Visitor not found' using errcode = 'no_data_found';
  end if;

  if visitor.status = 'converted'::public.visitor_status then
    raise exception 'That visitor has already been registered as a member'
      using errcode = 'check_violation';
  end if;

  select * into member from public.members where id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  if member.org_id <> visitor.org_id then
    raise exception 'That member belongs to another organisation'
      using errcode = 'insufficient_privilege';
  end if;

  update public.visitors
     set status = 'converted'::public.visitor_status,
         converted_member_id = p_member_id,
         converted_at = now()
   where id = p_visitor_id;

  if not found then
    raise exception 'You cannot change that visitor'
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'visitor_id', p_visitor_id,
    'member_id', p_member_id
  );
end;
$$;

revoke all on function public.convert_visitor(uuid, uuid) from public, anon;
grant execute on function public.convert_visitor(uuid, uuid) to authenticated;
