-- card_placement_is_valid() let a placement with a missing key through:
-- jsonb_typeof() of a missing key is null, and "if not null" never fires.
-- Every leg is coalesced so a hole in the shape reads as false, not unknown.
-- (20261108100300_card_designs.sql carries the corrected body too, so a fresh
-- database gets it either way; this file mirrors what was applied remotely.)
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
