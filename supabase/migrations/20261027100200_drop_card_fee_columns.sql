-- The fixed card-fee columns are superseded by the fees catalogue.
--
-- 20261026100000 added them and no app that reads them ever reached a staff
-- device or a deployed console, and every row holds 0. Dropping them removes
-- the concept instead of carrying a second way to say the same thing.
-- renew_membership stopped referencing them in 20261027100100, which must be
-- applied first.
--
-- signup_fee_paisa (plans, memberships) and standard_signup_fee_paisa (orgs)
-- stay: deployed apps read them, the legacy path charges from them while an
-- org's fee_catalogue_enabled is false, and the membership columns are
-- financial history.

alter table public.membership_plans drop column card_fee_paisa;
alter table public.orgs drop column standard_card_fee_paisa;
alter table public.memberships
  drop column card_fee_paisa,
  drop column card_fee_waived_paisa;

comment on column public.membership_plans.signup_fee_paisa is
  'Legacy joining fee, in paisa. Charged once, on a member''s first membership, only while the org''s fee_catalogue_enabled is false; otherwise the fees catalogue decides.';
comment on column public.orgs.standard_signup_fee_paisa is
  'Legacy list joining fee, in paisa: the reference a document strikes out when the legacy fee is not charged. Used only while fee_catalogue_enabled is false.';
