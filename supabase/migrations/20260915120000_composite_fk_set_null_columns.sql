-- Composite (child_id, org_id) foreign keys declared ON DELETE SET NULL made
-- Postgres null *every* referencing column, org_id included. Deleting a member,
-- staff row, membership, invoice, branch or plan therefore failed with
-- "null value in column org_id ... violates not-null constraint".
-- Postgres 15+ lets the action name the columns to null, which is what was
-- always meant: drop the link, keep the tenant.

alter table public.attendance
  drop constraint attendance_checked_in_by_fkey,
  add constraint attendance_checked_in_by_fkey
    foreign key (checked_in_by, org_id) references public.staff (id, org_id)
    on delete set null (checked_in_by);

alter table public.attendance
  drop constraint attendance_membership_fkey,
  add constraint attendance_membership_fkey
    foreign key (membership_id, org_id) references public.memberships (id, org_id)
    on delete set null (membership_id);

alter table public.class_sessions
  drop constraint class_sessions_trainer_fkey,
  add constraint class_sessions_trainer_fkey
    foreign key (trainer_id, org_id) references public.staff (id, org_id)
    on delete set null (trainer_id);

alter table public.classes
  drop constraint classes_trainer_fkey,
  add constraint classes_trainer_fkey
    foreign key (trainer_id, org_id) references public.staff (id, org_id)
    on delete set null (trainer_id);

alter table public.members
  drop constraint members_archived_by_fkey,
  add constraint members_archived_by_fkey
    foreign key (archived_by, org_id) references public.staff (id, org_id)
    on delete set null (archived_by);

alter table public.members
  drop constraint members_created_by_fkey,
  add constraint members_created_by_fkey
    foreign key (created_by, org_id) references public.staff (id, org_id)
    on delete set null (created_by);

alter table public.members
  drop constraint members_invited_by_fkey,
  add constraint members_invited_by_fkey
    foreign key (invited_by, org_id) references public.staff (id, org_id)
    on delete set null (invited_by);

alter table public.memberships
  drop constraint memberships_sold_by_fkey,
  add constraint memberships_sold_by_fkey
    foreign key (sold_by, org_id) references public.staff (id, org_id)
    on delete set null (sold_by);

alter table public.notification_messages
  drop constraint notification_messages_branch_fk,
  add constraint notification_messages_branch_fk
    foreign key (branch_id, org_id) references public.branches (id, org_id)
    on delete set null (branch_id);

alter table public.notification_messages
  drop constraint notification_messages_member_fk,
  add constraint notification_messages_member_fk
    foreign key (member_id, org_id) references public.members (id, org_id)
    on delete set null (member_id);

alter table public.notification_messages
  drop constraint notification_messages_staff_fk,
  add constraint notification_messages_staff_fk
    foreign key (staff_id, org_id) references public.staff (id, org_id)
    on delete set null (staff_id);

alter table public.notification_messages
  drop constraint notification_messages_visitor_fk,
  add constraint notification_messages_visitor_fk
    foreign key (visitor_id, org_id) references public.visitors (id, org_id)
    on delete set null (visitor_id);

alter table public.payments
  drop constraint payments_collected_by_fkey,
  add constraint payments_collected_by_fkey
    foreign key (collected_by, org_id) references public.staff (id, org_id)
    on delete set null (collected_by);

alter table public.payments
  drop constraint payments_invoice_fkey,
  add constraint payments_invoice_fkey
    foreign key (invoice_id, org_id) references public.invoices (id, org_id)
    on delete set null (invoice_id);

alter table public.payments
  drop constraint payments_membership_fkey,
  add constraint payments_membership_fkey
    foreign key (membership_id, org_id) references public.memberships (id, org_id)
    on delete set null (membership_id);

alter table public.push_log
  drop constraint push_log_member_id_org_id_fkey,
  add constraint push_log_member_id_org_id_fkey
    foreign key (member_id, org_id) references public.members (id, org_id)
    on delete set null (member_id);

alter table public.visitors
  drop constraint visitors_converted_member_id_fkey,
  add constraint visitors_converted_member_id_fkey
    foreign key (converted_member_id, org_id) references public.members (id, org_id)
    on delete set null (converted_member_id);

alter table public.visitors
  drop constraint visitors_created_by_fkey,
  add constraint visitors_created_by_fkey
    foreign key (created_by, org_id) references public.staff (id, org_id)
    on delete set null (created_by);

alter table public.visitors
  drop constraint visitors_interested_plan_id_fkey,
  add constraint visitors_interested_plan_id_fkey
    foreign key (interested_plan_id, org_id) references public.membership_plans (id, org_id)
    on delete set null (interested_plan_id);

-- Second half of the same delete: visitors_converted_shape insists a
-- 'converted' visitor still points at a member, so nulling converted_member_id
-- alone trades one violation for another. A permanently deleted member never
-- existed, so the visitor goes back to 'contacted' -- they walked in, and no
-- conversion is on file any more. Runs BEFORE the delete, so the FK action
-- above finds nothing left to null.
create or replace function public.unconvert_visitors_of_deleted_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.visitors
     set status = 'contacted',
         converted_member_id = null,
         converted_at = null
   where converted_member_id = old.id
     and org_id = old.org_id;
  return old;
end;
$$;

revoke all on function public.unconvert_visitors_of_deleted_member() from public;

drop trigger if exists members_unconvert_visitors on public.members;
create trigger members_unconvert_visitors
  before delete on public.members
  for each row execute function public.unconvert_visitors_of_deleted_member();
