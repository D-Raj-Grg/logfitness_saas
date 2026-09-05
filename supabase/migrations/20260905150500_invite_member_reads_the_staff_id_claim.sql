-- invite_member() resolved the inviting staff row by auth.uid(). The staff_id
-- claim is already on the token and is what every RLS policy uses, so read that
-- instead and fall back to the lookup only when a session predates the claim.
-- Also fail loudly when the update touches nothing: RLS refusing the row must
-- not look like a successful invitation.
create or replace function public.invite_member(
  p_member_id uuid,
  p_email text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_member public.members;
  v_actor uuid;
  v_updated integer;
begin
  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'A valid email address is required to invite a member'
      using errcode = 'check_violation';
  end if;

  select * into v_member from public.members where id = p_member_id;

  if v_member.id is null then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  if v_member.auth_user_id is not null then
    raise exception 'That member already has an app account'
      using errcode = 'unique_violation';
  end if;

  v_actor := coalesce(
    public.jwt_staff_id(),
    (select st.id from public.staff st where st.auth_user_id = auth.uid())
  );

  update public.members
  set email = v_email,
      invited_by = v_actor,
      invited_at = now()
  where id = p_member_id;

  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    raise exception 'Not allowed to invite that member'
      using errcode = 'insufficient_privilege';
  end if;

  return p_member_id;
end;
$$;
