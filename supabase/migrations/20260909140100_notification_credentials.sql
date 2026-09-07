-- Phase 5, part 2 of 6: gateway credentials.
--
-- The same problem the QR token had, and the same answer. A Supabase project
-- secret can only be set from the dashboard or a logged-in CLI; neither is
-- available to this project's tooling, which is why `qr-token` sat answering
-- 503 until its key moved into Vault, and why `push-fanout`'s FCM path is
-- still unverified today. So an SMS gateway token is written into
-- supabase_vault by an RPC the owner can call from /settings, and read back
-- only by the sender.
--
-- Per-org rather than platform-wide, because it is not one account. Each gym
-- chain buys its own credits and registers its own sender ID with the NTA;
-- a message from "LORDGYMS" for a gym called something else is the wrong
-- message even when it arrives.
--
-- The asymmetry is deliberate: `set_notification_credential` is callable by an
-- owner, `notification_credential` is callable by nobody but a definer
-- function. The console can replace a token it can never read.

create or replace function public.notification_secret_name(p_provider_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'notif:' || p_provider_id::text;
$$;

create or replace function public.set_notification_credential(
  p_provider_id uuid,
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text := public.notification_secret_name(p_provider_id);
  v_secret_id uuid;
begin
  if p_secret is null or length(btrim(p_secret)) = 0 then
    raise exception 'The gateway token cannot be blank'
      using errcode = 'check_violation';
  end if;

  -- Definer, so the RLS policy on notification_providers is not what protects
  -- this. The check is made by hand, exactly as the booking RPCs do.
  select p.org_id into v_org
  from public.notification_providers p
  where p.id = p_provider_id;

  if v_org is null then
    raise exception 'That gateway does not exist'
      using errcode = 'no_data_found';
  end if;

  if not (public.is_org_member(v_org) and public.jwt_is_staff() and public.jwt_is_owner()) then
    raise exception 'Only an owner can set a gateway token'
      using errcode = 'insufficient_privilege';
  end if;

  select s.id into v_secret_id from vault.secrets s where s.name = v_name;

  if v_secret_id is null then
    perform vault.create_secret(btrim(p_secret), v_name, 'Notification gateway token');
  else
    perform vault.update_secret(v_secret_id, btrim(p_secret));
  end if;

  update public.notification_providers
     set secret_name = v_name
   where id = p_provider_id;
end;
$$;

create or replace function public.clear_notification_credential(p_provider_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text := public.notification_secret_name(p_provider_id);
begin
  select p.org_id into v_org
  from public.notification_providers p
  where p.id = p_provider_id;

  if v_org is null then
    raise exception 'That gateway does not exist'
      using errcode = 'no_data_found';
  end if;

  if not (public.is_org_member(v_org) and public.jwt_is_staff() and public.jwt_is_owner()) then
    raise exception 'Only an owner can clear a gateway token'
      using errcode = 'insufficient_privilege';
  end if;

  delete from vault.secrets where name = v_name;

  update public.notification_providers
     set secret_name = null
   where id = p_provider_id;
end;
$$;

-- The console needs to render "a token is set" without ever holding the token.
create or replace function public.notification_has_credential(p_provider_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select p.org_id into v_org
  from public.notification_providers p
  where p.id = p_provider_id;

  if v_org is null or not (public.is_org_member(v_org) and public.jwt_is_staff() and public.jwt_is_owner()) then
    return false;
  end if;

  return exists (
    select 1 from vault.secrets s
    where s.name = public.notification_secret_name(p_provider_id)
  );
end;
$$;

-- Read the token itself. Callable by no client role at all -- only by the
-- sender, which is a definer function owned by the same role. Same standing as
-- `public.qr_signing_key()`.
create or replace function public.notification_credential(p_provider_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name = public.notification_secret_name(p_provider_id);
$$;

revoke execute on function public.notification_secret_name(uuid) from public, anon;
grant execute on function public.notification_secret_name(uuid) to authenticated;

revoke execute on function public.set_notification_credential(uuid, text) from public, anon;
grant execute on function public.set_notification_credential(uuid, text) to authenticated;

revoke execute on function public.clear_notification_credential(uuid) from public, anon;
grant execute on function public.clear_notification_credential(uuid) to authenticated;

revoke execute on function public.notification_has_credential(uuid) from public, anon;
grant execute on function public.notification_has_credential(uuid) to authenticated;

revoke execute on function public.notification_credential(uuid) from public, anon, authenticated;
