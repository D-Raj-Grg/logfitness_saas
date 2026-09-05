-- verify_qr_token() gated the scanner on is_org_member() alone. That was a
-- staff-only test until members started carrying org_id, and it would now let
-- one member resolve another member's token into a name and member code.
-- Scanning is a counter operation: require a staff principal.
create or replace function public.verify_qr_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parts text[];
  v_payload text;
  v_org_id uuid;
  v_member_id uuid;
  v_exp bigint;
  v_member public.members%rowtype;
begin
  v_parts := string_to_array(coalesce(p_token, ''), '.');

  if array_length(v_parts, 1) is distinct from 5 or v_parts[1] <> 'v1' then
    return jsonb_build_object('valid', false, 'reason', 'malformed');
  end if;

  begin
    v_org_id := v_parts[2]::uuid;
    v_member_id := v_parts[3]::uuid;
    v_exp := v_parts[4]::bigint;
  exception when others then
    return jsonb_build_object('valid', false, 'reason', 'malformed');
  end;

  v_payload := 'v1.' || v_parts[2] || '.' || v_parts[3] || '.' || v_parts[4];

  -- Compare digests, not the signatures themselves: equal-length text
  -- comparison in Postgres short-circuits, and that is a timing oracle on the
  -- one value an attacker is trying to guess.
  if extensions.digest(v_parts[5], 'sha256')
     <> extensions.digest(
          public.qr_sign(v_payload, public.qr_signing_key()), 'sha256'
        ) then
    return jsonb_build_object('valid', false, 'reason', 'bad_signature');
  end if;

  if v_exp < extract(epoch from now())::bigint then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  -- A valid signature is not authorisation. The scanner still has to be staff
  -- of this chain, and the token cannot name a member from another one.
  select * into v_member from public.members m where m.id = v_member_id;

  if not found
     or v_member.org_id <> v_org_id
     or not public.is_org_member(v_member.org_id)
     or not public.jwt_is_staff() then
    return jsonb_build_object('valid', false, 'reason', 'not_visible');
  end if;

  return jsonb_build_object(
    'valid', true,
    'reason', null,
    'member_id', v_member.id,
    'org_id', v_member.org_id,
    'member_code', v_member.member_code,
    'full_name', v_member.full_name,
    'home_branch_id', v_member.home_branch_id,
    'expires_at', to_timestamp(v_exp)
  );
end;
$$;
