-- Restores the pre-change behavior (treasurer can update payments, add/void charges, etc.).
-- Run manually only; this file is intentionally NOT in supabase/migrations.
alter policy "Secretary can update payments" on public.payments
  using ((select public.current_user_role()) = any (array['secretary'::text, 'treasurer'::text]))
  with check ((select public.current_user_role()) = any (array['secretary'::text, 'treasurer'::text]));
alter policy "Secretary can update payments" on public.payments
  rename to "Secretary and Treasurer can update payments";

alter policy "Admin and Secretary can add manual charges" on public.property_charges
  with check (
    ((select public.current_user_role()) = any (array['admin'::text, 'secretary'::text, 'treasurer'::text]))
    and (created_by = (select auth.uid()))
    and (billing_month is null)
    and (voided_at is null)
  );
alter policy "Admin and Secretary can add manual charges" on public.property_charges
  rename to "Staff can add manual charges";

alter policy "Admin and Secretary can void charges" on public.property_charges
  using ((select public.current_user_role()) = any (array['admin'::text, 'secretary'::text, 'treasurer'::text]))
  with check ((select public.current_user_role()) = any (array['admin'::text, 'secretary'::text, 'treasurer'::text]));
alter policy "Admin and Secretary can void charges" on public.property_charges
  rename to "Staff can void charges";

create or replace function public.restore_voided_charge(p_charge_id uuid)
 returns void language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(public.current_user_role(), '') not in ('admin', 'secretary', 'treasurer') then
    raise exception 'You do not have permission to restore charges.';
  end if;
  perform set_config('app.restore_charge', 'on', true);
  update public.property_charges set voided_at = null
   where id = p_charge_id and voided_at is not null and charge_type = 'Association Dues';
  if not found then
    raise exception 'Only a voided monthly dues charge can be restored.';
  end if;
end $function$;

create or replace function public.void_service_transaction(p_id uuid, p_reason text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  r public.service_transactions%rowtype;
begin
  if coalesce(public.current_user_role(), '') not in ('secretary', 'treasurer') then
    raise exception 'You do not have permission to void service receipts.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason is required to void a receipt (at least 5 characters).';
  end if;
  select * into r from public.service_transactions where id = p_id for update;
  if not found then raise exception 'Receipt not found.'; end if;
  if lower(coalesce(r.payment_status, 'paid')) = 'voided' then
    raise exception 'Receipt % is already voided.', r.receipt_number;
  end if;
  if r.balance_of is null and exists (
       select 1 from public.service_transactions x
        where x.balance_of = r.id and lower(coalesce(x.payment_status, 'paid')) <> 'voided') then
    raise exception 'Receipt % has balance payments. Void those first.', r.receipt_number;
  end if;
  update public.service_transactions
     set payment_status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_id;
end $function$;
