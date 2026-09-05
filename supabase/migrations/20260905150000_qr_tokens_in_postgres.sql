-- QR check-in tokens, minted and verified in Postgres.
--
-- The first cut of this lived in the `qr-token` Edge Function, keyed by a
-- `QR_TOKEN_SECRET` project secret. That secret can only be set from the
-- dashboard or a logged-in CLI, which made the whole path un-provisionable from
-- the tooling this project actually uses, and left a deployed function that
-- answered 503. Moving it here also puts it back inside the rule the rest of the
-- system follows: logic the Flutter app needs lives in the database, reachable
-- as one RPC under the same RLS as everything else.
--
-- The signing key lives in Vault and is created on first use, so a fresh
-- database provisions itself. It is never in the repo and never leaves the
-- server: only these SECURITY DEFINER functions can read it, and they only ever
-- return a signature.

-- SECURITY DEFINER because vault.decrypted_secrets is not readable by
-- `authenticated`. Nothing outside this file may call it.
create or replace function public.qr_signing_key()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'qr_token_key';

  if v_secret is null then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'qr_token_key',
      'HMAC key for QR check-in tokens'
    );

    select s.decrypted_secret into v_secret
    from vault.decrypted_secrets s
    where s.name = 'qr_token_key';
  end if;

  if v_secret is null then
    raise exception 'The QR signing key could not be provisioned'
      using errcode = 'internal_error';
  end if;

  return v_secret;
end;
$$;

-- base64url, so the token survives a URL and a QR alphabet unescaped.
create or replace function public.qr_sign(p_payload text, p_key text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select rtrim(
    translate(
      replace(encode(extensions.hmac(p_payload, p_key, 'sha256'), 'base64'), e'\n', ''),
      '+/', '-_'
    ),
    '='
  );
$$;

/**
 * Mints a short-lived token for one member.
 *
 * A member mints for themselves once the Flutter app links them to an auth
 * user; staff may mint for any member they are allowed to serve, which is how a
 * printed QR card gets issued at the desk. SECURITY DEFINER only because of the
 * key, so both of those checks are made explicitly here rather than left to RLS.
 */
create or replace function public.mint_qr_token(
  p_member_id uuid default null,
  p_ttl_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_ttl integer;
  v_exp bigint;
  v_payload text;
begin
  -- Self-service first: a member never has to name their own id.
  select * into v_member
  from public.members m
  where m.auth_user_id = (select auth.uid());

  if not found then
    if p_member_id is null then
      raise exception 'No member to mint a token for' using errcode = 'no_data_found';
    end if;

    select * into v_member from public.members m where m.id = p_member_id;

    if not found
       or not public.is_org_member(v_member.org_id)
       or not public.jwt_can_serve_members() then
      raise exception 'Member not found' using errcode = 'no_data_found';
    end if;
  end if;

  v_ttl := least(greatest(coalesce(p_ttl_seconds, 90), 10), 900);
  v_exp := extract(epoch from now())::bigint + v_ttl;
  v_payload := 'v1.' || v_member.org_id || '.' || v_member.id || '.' || v_exp;

  return jsonb_build_object(
    'token', v_payload || '.' || public.qr_sign(v_payload, public.qr_signing_key()),
    'member_id', v_member.id,
    'ttl_seconds', v_ttl,
    'expires_at', to_timestamp(v_exp)
  );
end;
$$;

/**
 * Verifies a scanned token. Does NOT record attendance: the scanner calls
 * check_in_member() with method 'qr' afterwards, so there is exactly one place
 * where the door rules live, whoever opened it.
 */
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
     or not public.is_org_member(v_member.org_id) then
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

-- Supabase grants EXECUTE on every new public function to anon and
-- authenticated by default. The key readers are internal; the two RPCs are not.
revoke execute on function public.qr_signing_key() from public, anon, authenticated;
revoke execute on function public.qr_sign(text, text) from public, anon, authenticated;
revoke execute on function public.mint_qr_token(uuid, integer) from public, anon;
revoke execute on function public.verify_qr_token(text) from public, anon;

grant execute on function public.mint_qr_token(uuid, integer) to authenticated;
grant execute on function public.verify_qr_token(text) to authenticated;
