-- Deleting an org cascades to branches, plans, members, memberships, invoices,
-- and payments at once, and Postgres does not promise an order. A RESTRICT
-- reference from a payment to its branch could therefore fire mid-teardown and
-- make orgs undeletable -- the same class of bug the Phase 0 cascade fixes
-- addressed for staff and the audit log.
--
-- NO ACTION DEFERRABLE INITIALLY DEFERRED keeps the protection (you still cannot
-- delete a branch that has members) but checks it at commit, by which time a
-- full org teardown has removed both sides.

alter table public.members
  drop constraint members_home_branch_fkey,
  add constraint members_home_branch_fkey
    foreign key (home_branch_id, org_id)
    references public.branches (id, org_id)
    on delete no action
    deferrable initially deferred;

alter table public.memberships
  drop constraint memberships_branch_fkey,
  add constraint memberships_branch_fkey
    foreign key (branch_id, org_id)
    references public.branches (id, org_id)
    on delete no action
    deferrable initially deferred;

alter table public.memberships
  drop constraint memberships_plan_fkey,
  add constraint memberships_plan_fkey
    foreign key (plan_id, org_id)
    references public.membership_plans (id, org_id)
    on delete no action
    deferrable initially deferred;

alter table public.invoices
  drop constraint invoices_branch_fkey,
  add constraint invoices_branch_fkey
    foreign key (branch_id, org_id)
    references public.branches (id, org_id)
    on delete no action
    deferrable initially deferred;

alter table public.payments
  drop constraint payments_branch_fkey,
  add constraint payments_branch_fkey
    foreign key (branch_id, org_id)
    references public.branches (id, org_id)
    on delete no action
    deferrable initially deferred;
