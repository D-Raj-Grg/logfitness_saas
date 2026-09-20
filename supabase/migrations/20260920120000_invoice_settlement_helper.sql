-- What an invoice has been paid is derived, not typed -- and now it is derived
-- from one place.
--
-- `sync_invoice_totals` has been the only thing that knows the settlement rule
-- (void sticks; paid when the payments cover the total; unpaid at zero;
-- partial otherwise), and it only ever ran from a payment trigger. That was
-- enough while the total could never change after the sale. The next migration
-- lets an owner lower a price that was already billed, which moves the total
-- underneath payments that are already in, so the same rule has to be callable
-- without a payment row to hang it on.
--
-- The rule moves into settle_invoice() unchanged. sync_invoice_totals keeps
-- its trigger and its INSERT/DELETE return shape and simply calls it.

create or replace function public.settle_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  settled bigint;
begin
  if p_invoice_id is null
     or not exists (select 1 from public.invoices where id = p_invoice_id) then
    return;
  end if;

  select coalesce(sum(p.amount_paisa), 0) into settled
  from public.payments p
  where p.invoice_id = p_invoice_id;

  -- The flag the money guard added in the next migration opens for. `set
  -- local` dies with the transaction, so it can never leak into a PostgREST
  -- statement: that is the whole point of using a GUC rather than a role.
  perform set_config('app.settle_invoice', 'on', true);

  update public.invoices i
     set paid_paisa = settled,
         status = (case
           when i.status = 'void' then 'void'
           when settled >= i.total_paisa then 'paid'
           when settled <= 0 then 'unpaid'
           else 'partial'
         end)::public.invoice_status
   where i.id = p_invoice_id;

  perform set_config('app.settle_invoice', 'off', true);
end;
$$;

revoke execute on function public.settle_invoice(uuid) from public, anon, authenticated;

comment on function public.settle_invoice(uuid) is
  'Re-derives paid_paisa and status from the payment rows. The one place that decides whether an invoice is settled.';


-- Unchanged from 20260905120400 except that the rule now lives in
-- settle_invoice(); the trigger and its return contract are identical.
create or replace function public.sync_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_invoice uuid;
begin
  -- OLD is unassigned on INSERT, so it cannot be read unconditionally.
  if tg_op = 'INSERT' then
    target_invoice := new.invoice_id;
  else
    target_invoice := old.invoice_id;
  end if;

  perform public.settle_invoice(target_invoice);

  if tg_op = 'INSERT' then
    return new;
  end if;

  return old;
end;
$$;

revoke execute on function public.sync_invoice_totals() from public, anon, authenticated;
