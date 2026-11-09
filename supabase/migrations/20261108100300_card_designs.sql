-- Card designs. A gym uploads a picture of its printed card and marks where
-- the number ("NO. 0004") and the QR go on it; the designer then lays a run of
-- numbers onto that picture and hands back a PDF for the print shop. The
-- design is saved so a later run -- or a re-download of an old batch -- uses
-- the same picture without uploading it again.
--
-- The picture lives in a PRIVATE bucket (card-templates), keyed
-- <org_id>/<random>.<ext>: a fresh name per upload, so a stale signed URL can
-- never show an older picture, and the first folder is the tenant boundary
-- (public.storage_object_org). The placement is a handful of fractions of the
-- picture, so it is jsonb on the design row; label_prefix is what is printed
-- before the number ("NO.", "No", or nothing).
--
--   read the picture / list designs:          any staff in the org
--   upload / delete the picture, save / delete: owner or manager
--
-- card_stock.design_id and card_batches.design_id were left without a key in
-- the card stock migration because this table did not exist yet. Both get a
-- composite key here, so a design id from another org is refused by the
-- database, not by the RPC's good manners. Deleting a design leaves its runs
-- and stock in place, pointing nowhere.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-templates',
  'card-templates',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "staff read card templates in their org"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'card-templates'
    and public.is_org_member(public.storage_object_org(name))
    and public.jwt_is_staff()
  );

create policy "owners and managers upload card templates"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'card-templates'
    and public.is_org_member(public.storage_object_org(name))
    and coalesce(
      public.jwt_staff_role() in ('owner'::public.staff_role, 'manager'::public.staff_role),
      false
    )
  );

create policy "owners and managers delete card templates"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'card-templates'
    and public.is_org_member(public.storage_object_org(name))
    and coalesce(
      public.jwt_staff_role() in ('owner'::public.staff_role, 'manager'::public.staff_role),
      false
    )
  );

-- ---------------------------------------------------------------------------

create table public.card_designs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  image_path text not null,
  width integer not null,
  height integer not null,
  placement jsonb not null,
  label_prefix text not null default 'NO.',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint card_designs_id_org_id_key unique (id, org_id),
  constraint card_designs_org_name_key unique (org_id, name),
  constraint card_designs_name_check check (length(btrim(name)) between 1 and 80),
  constraint card_designs_width_check check (width > 0),
  constraint card_designs_height_check check (height > 0),
  constraint card_designs_label_prefix_check check (length(label_prefix) <= 8),
  constraint card_designs_created_by_fkey
    foreign key (created_by, org_id) references public.staff (id, org_id)
    on delete set null (created_by)
);

comment on table public.card_designs is
  'A printed-card template: the picture in the card-templates bucket and where the number and QR sit on it. Written only through save_card_design / delete_card_design (owner or manager); staff read their org''s rows.';
comment on column public.card_designs.placement is
  'Fractions of the picture: {code:{x,y,w,h}, qr:{x,y,s}, codeColor, qrColor, codeScale, qrInset}. Mirrored by lib/cards/card-design.ts.';
comment on column public.card_designs.label_prefix is
  'Printed before the number: "NO." gives "NO. 0004", "" gives "0004". At most 8 characters.';

create trigger card_designs_set_updated_at
  before update on public.card_designs
  for each row execute function public.set_updated_at();

-- The stock and batch columns now point at a design of the same org.
alter table public.card_stock
  add constraint card_stock_design_fkey
    foreign key (design_id, org_id) references public.card_designs (id, org_id)
    on delete set null (design_id);

alter table public.card_batches
  add constraint card_batches_design_fkey
    foreign key (design_id, org_id) references public.card_designs (id, org_id)
    on delete set null (design_id);

-- The set-null on delete walks these; without an index it is a scan per design.
create index card_stock_design_idx on public.card_stock (design_id) where design_id is not null;
create index card_batches_design_idx on public.card_batches (design_id) where design_id is not null;

-- ---------------------------------------------------------------------------
-- RPCs

-- Is the placement shaped like one: numeric code.x/y/w/h and qr.x/y/s, all in 0..1.
create or replace function public.card_placement_is_valid(p_placement jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  -- A missing key makes jsonb_typeof() null, and null never fails an "if not";
  -- every leg is coalesced so a hole in the shape reads as false, not unknown.
  select coalesce(
    jsonb_typeof(p_placement) = 'object'
    and jsonb_typeof(p_placement -> 'code') = 'object'
    and jsonb_typeof(p_placement -> 'qr') = 'object'
    and (
      select bool_and(
        coalesce(jsonb_typeof(p_placement -> 'code' -> k) = 'number', false)
        and (p_placement -> 'code' ->> k)::numeric between 0 and 1
      )
      from unnest(array['x', 'y', 'w', 'h']) as k
    )
    and (
      select bool_and(
        coalesce(jsonb_typeof(p_placement -> 'qr' -> k) = 'number', false)
        and (p_placement -> 'qr' ->> k)::numeric between 0 and 1
      )
      from unnest(array['x', 'y', 's']) as k
    ),
    false
  );
$$;

-- Create (p_id null) or update a design. Owner or manager. The picture must
-- sit in the caller's own folder of the bucket.
create or replace function public.save_card_design(
  p_id uuid,
  p_name text,
  p_image_path text,
  p_width integer,
  p_height integer,
  p_placement jsonb,
  p_label_prefix text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_staff_id uuid := public.jwt_staff_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_prefix text := coalesce(p_label_prefix, 'NO.');
  v_out uuid;
begin
  if v_org_id is null or v_staff_id is null
     or not coalesce(
       public.jwt_staff_role() in ('owner'::public.staff_role, 'manager'::public.staff_role),
       false
     )
  then
    raise exception 'Only owners and managers can save card designs'
      using errcode = 'insufficient_privilege';
  end if;

  if length(v_name) not between 1 and 80 then
    raise exception 'Give the design a name of up to 80 characters'
      using errcode = 'check_violation';
  end if;

  if length(v_prefix) > 8 then
    raise exception 'The label prefix is at most 8 characters'
      using errcode = 'check_violation';
  end if;

  if p_width is null or p_height is null or p_width < 1 or p_height < 1 then
    raise exception 'The template size is missing'
      using errcode = 'check_violation';
  end if;

  if not public.card_placement_is_valid(p_placement) then
    raise exception 'The placement is missing or outside the picture'
      using errcode = 'check_violation';
  end if;

  if p_image_path is null
     or public.storage_object_org(p_image_path) is distinct from v_org_id
  then
    raise exception 'The template picture belongs to another gym'
      using errcode = 'check_violation';
  end if;

  if p_id is null then
    insert into public.card_designs
      (org_id, name, image_path, width, height, placement, label_prefix, created_by)
    values
      (v_org_id, v_name, p_image_path, p_width, p_height, p_placement, v_prefix, v_staff_id)
    returning id into v_out;
  else
    update public.card_designs d
    set name = v_name,
        image_path = p_image_path,
        width = p_width,
        height = p_height,
        placement = p_placement,
        label_prefix = v_prefix
    where d.id = p_id and d.org_id = v_org_id
    returning d.id into v_out;
    if v_out is null then
      raise exception 'That design does not exist'
        using errcode = 'no_data_found';
    end if;
  end if;

  return v_out;
exception
  when invalid_text_representation then
    -- storage_object_org() on a path whose first folder is not a uuid
    raise exception 'The template picture belongs to another gym'
      using errcode = 'check_violation';
end;
$$;

-- Delete a design; hands back the picture path so the caller can remove the
-- object. Stock and batches that used it stay, with design_id set null.
create or replace function public.delete_card_design(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_path text;
begin
  if v_org_id is null
     or not coalesce(
       public.jwt_staff_role() in ('owner'::public.staff_role, 'manager'::public.staff_role),
       false
     )
  then
    raise exception 'Only owners and managers can delete card designs'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.card_designs d
  where d.id = p_id and d.org_id = v_org_id
  returning d.image_path into v_path;

  if v_path is null then
    raise exception 'That design does not exist'
      using errcode = 'no_data_found';
  end if;

  return v_path;
end;
$$;

-- RLS ------------------------------------------------------------------------
alter table public.card_designs enable row level security;

create policy "staff read card designs in their org"
  on public.card_designs for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

-- No write policies, and no write privilege either: every write goes through
-- the definer RPCs above, so a direct write is refused outright.
revoke insert, update, delete on public.card_designs from anon, authenticated;

-- Grants -----------------------------------------------------------------------
revoke execute on function public.card_placement_is_valid(jsonb) from public, anon;
revoke execute on function public.save_card_design(uuid, text, text, integer, integer, jsonb, text) from public, anon;
revoke execute on function public.delete_card_design(uuid) from public, anon;

grant execute on function public.card_placement_is_valid(jsonb) to authenticated;
grant execute on function public.save_card_design(uuid, text, text, integer, integer, jsonb, text) to authenticated;
grant execute on function public.delete_card_design(uuid) to authenticated;
