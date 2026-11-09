-- Card stock, second hardening (security review of the cards UI): a card
-- marked lost or retired could still be handed out through the plain uid path
-- (assign_member_card / assign_staff_card with the chip's uid), bypassing the
-- status check that assign_card_stock_to_member makes. The rule now lives at
-- the sink: a member_cards or staff_cards insert for a uid that is numbered
-- stock is refused unless that stock row is free.

create or replace function public.assert_card_stock_usable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock public.card_stock%rowtype;
begin
  if new.revoked_at is not null then
    return new;
  end if;

  select * into v_stock
  from public.card_stock cs
  where cs.org_id = new.org_id and cs.card_uid = new.card_uid;

  if found and v_stock.status <> 'free'::public.card_stock_status then
    raise exception 'Card % is marked %', public.format_card_no(v_stock.card_no), v_stock.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger member_cards_card_stock_usable
  before insert on public.member_cards
  for each row execute function public.assert_card_stock_usable();

create trigger staff_cards_card_stock_usable
  before insert on public.staff_cards
  for each row execute function public.assert_card_stock_usable();

revoke execute on function public.assert_card_stock_usable() from public, anon, authenticated;
