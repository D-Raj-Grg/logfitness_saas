-- Card designs: the template picture and where the number and QR sit on it,
-- saved per org so a print run can be re-downloaded later. Saving and deleting
-- is owner/manager work through the definer RPCs; reading is any staff in the
-- org; a design never crosses an org boundary, not even as a foreign key.
--
-- Seeds two orgs, drives the real RPCs as real personas, asserts, then removes
-- its fixtures. A failed assertion aborts.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/card_designs.sql

do $$
declare
  org_a uuid := 'd7d7d7d7-1111-1111-1111-111111111111';
  org_b uuid := 'd7d7d7d7-2222-2222-2222-222222222222';
  br_a1 uuid := 'd7b00000-0000-0000-0000-000000000001';
  br_b1 uuid := 'd7b00000-0000-0000-0000-000000000002';
  st_owner uuid := 'd7000000-0000-0000-0000-00000000000f';
  st_mgr   uuid := 'd7000000-0000-0000-0000-00000000000a';
  st_desk  uuid := 'd7000000-0000-0000-0000-00000000000d';
  st_b_owner uuid := 'd7000000-0000-0000-0000-00000000002f';

  placement jsonb := jsonb_build_object(
    'code', jsonb_build_object('x', 0.06, 'y', 0.78, 'w', 0.4, 'h', 0.12),
    'qr', jsonb_build_object('x', 0.72, 'y', 0.58, 's', 0.22),
    'codeColor', '#111111', 'qrColor', '#000000',
    'codeScale', 0.85, 'qrInset', 0.06
  );
  path_a text := 'd7d7d7d7-1111-1111-1111-111111111111/one.png';
  path_b text := 'd7d7d7d7-2222-2222-2222-222222222222/two.png';

  design_a uuid;
  batch_a uuid;
  other uuid;
  result jsonb;
  t text;
  n integer;
  failed boolean;
begin
  -- fixtures ------------------------------------------------------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Delta Fitness', 'delta-fitness-test'),
    (org_b, 'Epsilon Gyms', 'epsilon-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Delta One'),
    (br_b1, org_b, 'Epsilon One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Delta Owner',   'owner@delta.test', 'owner',      '{}',         'active'),
    (st_mgr,   org_a, 'Delta Manager', 'mgr@delta.test',   'manager',    array[br_a1], 'active'),
    (st_desk,  org_a, 'Delta Desk',    'desk@delta.test',  'front_desk', array[br_a1], 'active'),
    (st_b_owner, org_b, 'Epsilon Owner', 'owner@epsilon.test', 'owner',  '{}',         'active');

  -- the bucket exists, private, images only --------------------------------------
  select count(*) into n from storage.buckets
  where id = 'card-templates' and public = false
    and allowed_mime_types @> array['image/jpeg', 'image/png'];
  assert n = 1, 'the card-templates bucket is missing or misconfigured';

  -- persona: manager saves a design ---------------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_mgr::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  design_a := public.save_card_design(null, '  Blue front ', path_a, 1011, 638, placement, 'NO.');
  assert design_a is not null, 'save returned no id';
  select count(*) into n from public.card_designs
  where id = design_a and org_id = org_a and name = 'Blue front' and image_path = path_a
    and width = 1011 and height = 638 and label_prefix = 'NO.' and created_by = st_mgr;
  assert n = 1, 'the saved design row is wrong';

  -- update keeps the id, changes the rest
  other := public.save_card_design(design_a, 'Blue front v2', path_a, 1011, 638, placement, 'No');
  assert other = design_a, 'an update made a new row';
  select count(*) into n from public.card_designs where id = design_a and name = 'Blue front v2' and label_prefix = 'No';
  assert n = 1, 'the update did not land';
  -- an empty prefix is allowed (plain "0004")
  perform public.save_card_design(design_a, 'Blue front v2', path_a, 1011, 638, placement, '');
  select count(*) into n from public.card_designs where id = design_a and label_prefix = '';
  assert n = 1, 'an empty prefix was not stored';

  -- a prefix over 8 characters is refused
  failed := false;
  begin
    perform public.save_card_design(design_a, 'Blue front v2', path_a, 1011, 638, placement, 'MEMBER NO.');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a 10-character prefix was accepted';

  -- a placement outside 0..1 is refused
  failed := false;
  begin
    perform public.save_card_design(null, 'Bad', path_a, 1011, 638,
      jsonb_set(placement, '{qr,s}', '2'), 'NO.');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a QR side of 2 was accepted';

  -- a placement missing a key is refused
  failed := false;
  begin
    perform public.save_card_design(null, 'Bad', path_a, 1011, 638, placement - 'qr', 'NO.');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a placement without a qr box was accepted';

  -- a picture under another org's folder is refused
  failed := false;
  begin
    perform public.save_card_design(null, 'Stolen', path_b, 1011, 638, placement, 'NO.');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a template path under another org was accepted';

  -- a blank name is refused
  failed := false;
  begin
    perform public.save_card_design(null, '   ', path_a, 1011, 638, placement, 'NO.');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a blank design name was accepted';

  -- two designs cannot share a name in one org
  failed := false;
  begin
    perform public.save_card_design(null, 'Blue front v2', path_a, 1011, 638, placement, 'NO.');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'a duplicate design name was accepted';

  -- a run numbered with this design points at it
  result := public.create_card_stock_range(1, 2, design_a);
  assert (result ->> 'created')::integer = 2, 'the range was not created';
  select count(*) into n from public.card_stock where org_id = org_a and design_id = design_a;
  assert n = 2, 'the stock rows do not carry the design';
  select count(*) into n from public.card_batches where org_id = org_a and design_id = design_a;
  assert n = 1, 'the batch does not carry the design';

  -- "Download again" reads a batch's numbers and tokens back; they match what the run returned
  assert jsonb_array_length(result -> 'cards') = 2, format('the run should return both cards: %s', result);
  select count(*) into n
  from public.card_batch_qr_tokens((result ->> 'batch_id')::uuid) b
  join jsonb_array_elements(result -> 'cards') c
    on (c ->> 'card_no')::integer = b.card_no and c ->> 'token' = b.qr_token;
  assert n = 2, 'card_batch_qr_tokens does not match the tokens the run returned';
  batch_a := (result ->> 'batch_id')::uuid;

  -- a design id that exists nowhere is refused by the key
  failed := false;
  begin
    perform public.create_card_stock_range(3, 4, gen_random_uuid());
  exception when foreign_key_violation then failed := true;
  end;
  assert failed, 'a run was numbered against a design that does not exist';

  -- the front desk may read but not write --------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.card_designs;
  assert n = 1, 'the front desk cannot see the org''s designs';

  failed := false;
  begin
    perform public.save_card_design(null, 'Desk design', path_a, 10, 10, placement, 'NO.');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the front desk saved a design';

  failed := false;
  begin
    perform public.delete_card_design(design_a);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the front desk deleted a design';

  -- tokens are print material: owner/manager only, not the desk
  failed := false;
  begin
    perform * from public.card_batch_qr_tokens(batch_a);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the front desk read a batch''s card tokens';

  -- no direct writes for anyone signed in
  failed := false;
  begin
    insert into public.card_designs (org_id, name, image_path, width, height, placement)
    values (org_a, 'Direct', path_a, 1, 1, placement);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user inserted a design directly';

  failed := false;
  begin
    update public.card_designs set name = 'Renamed' where id = design_a;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user updated a design directly';

  -- another org sees none of it, and cannot borrow it -----------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.card_designs;
  assert n = 0, 'org B read org A''s designs';

  failed := false;
  begin
    perform public.save_card_design(design_a, 'Hijack', path_b, 1, 1, placement, 'NO.');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org B updated org A''s design';

  failed := false;
  begin
    perform public.create_card_stock_range(1, 2, design_a);
  exception when foreign_key_violation then failed := true;
  end;
  assert failed, 'org B numbered cards against org A''s design';
  select count(*) into n from public.card_stock where org_id = org_b;
  assert n = 0, 'the refused run left stock behind';

  failed := false;
  begin
    perform public.delete_card_design(design_a);
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org B deleted org A''s design';

  -- org B's owner asking for org A's batch gets nothing, not org A's tokens
  select count(*) into n from public.card_batch_qr_tokens(batch_a);
  assert n = 0, format('org B read %s of org A''s card tokens', n);

  -- the owner deletes; the stock and batch stay, pointing nowhere ------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  t := public.delete_card_design(design_a);
  assert t = path_a, format('delete should hand back the picture path, got %s', t);
  select count(*) into n from public.card_designs where id = design_a;
  assert n = 0, 'the design is still there';
  select count(*) into n from public.card_stock where org_id = org_a and design_id is null;
  assert n = 2, 'deleting the design did not unlink its stock';
  select count(*) into n from public.card_batches where org_id = org_a and design_id is null;
  assert n = 1, 'deleting the design did not unlink its batch';

  failed := false;
  begin
    perform public.delete_card_design(design_a);
  exception when no_data_found then failed := true;
  end;
  assert failed, 'deleting twice did not fail';

  -- teardown -------------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'card designs: all assertions passed';
end $$;
