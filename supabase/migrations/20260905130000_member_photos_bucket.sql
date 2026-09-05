-- Member photos. A private bucket, because a gym's member list with faces
-- attached is exactly the kind of thing that must not be world-readable.
-- Objects are keyed <org_id>/<member_id>/<file>, and the first path segment is
-- what the policies below check against the caller's org claim.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-photos',
  'member-photos',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The org that owns an object, read from the first folder in its path.
create or replace function public.storage_object_org(object_name text)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif((string_to_array(object_name, '/'))[1], '')::uuid;
$$;

revoke execute on function public.storage_object_org(text) from public, anon;
grant execute on function public.storage_object_org(text) to authenticated;

-- Read is org-wide, matching public.members: a member who walks into another
-- branch of the same chain must be recognisable there.
create policy "staff read member photos in their org"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'member-photos'
    and public.is_org_member(public.storage_object_org(name))
  );

-- Writes follow the same roles that may register and edit a member.
create policy "member-facing staff upload member photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'member-photos'
    and public.is_org_member(public.storage_object_org(name))
    and public.jwt_can_serve_members()
  );

create policy "member-facing staff replace member photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'member-photos'
    and public.is_org_member(public.storage_object_org(name))
    and public.jwt_can_serve_members()
  )
  with check (
    bucket_id = 'member-photos'
    and public.is_org_member(public.storage_object_org(name))
    and public.jwt_can_serve_members()
  );

create policy "member-facing staff delete member photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'member-photos'
    and public.is_org_member(public.storage_object_org(name))
    and public.jwt_can_serve_members()
  );
