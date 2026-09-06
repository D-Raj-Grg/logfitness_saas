-- The org logo, printed at the top of every invoice and receipt. Objects are
-- keyed <org_id>/logo-<epoch>.<ext>, so public.storage_object_org() from the
-- member-photos migration reads the owning org straight off the path.
--
-- Public, unlike member-photos, and deliberately so. The logo is embedded in a
-- page whose whole purpose is to be handed to the browser's print engine. A
-- signed URL adds three ways to print a logo-less invoice: the tab sits open
-- past the expiry, a cached render carries a dead signature, or the print
-- engine re-requests the image after it lapsed. A gym logo is on the shopfront
-- already, so the confidentiality cost of a stable URL is nil. The risk that
-- matters -- who can change it -- stays locked to owners below.
--
-- If this ever has to become private, do not reach for signed URLs: download
-- the bytes server-side and inline them as a data: URI, so nothing can expire
-- mid-print.
--
-- image/svg+xml is excluded on purpose: storage serves objects from its own
-- origin, and an SVG can carry script.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-logos',
  'org-logos',
  true,
  2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public reads bypass RLS through the /object/public/ path; this policy is what
-- lets signed-in staff list and read the object through the normal API.
create policy "staff read their org logo"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'org-logos'
    and public.is_org_member(public.storage_object_org(name))
  );

-- Branding is an owner's call, matching "owners update their own org".
create policy "owners upload their org logo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'org-logos'
    and public.is_org_member(public.storage_object_org(name))
    and public.jwt_is_owner()
  );

create policy "owners replace their org logo"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'org-logos'
    and public.is_org_member(public.storage_object_org(name))
    and public.jwt_is_owner()
  )
  with check (
    bucket_id = 'org-logos'
    and public.is_org_member(public.storage_object_org(name))
    and public.jwt_is_owner()
  );

create policy "owners delete their org logo"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'org-logos'
    and public.is_org_member(public.storage_object_org(name))
    and public.jwt_is_owner()
  );
