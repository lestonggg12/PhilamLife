-- Secretary audit High 1/2/3. No historical financial rows are rewritten.
begin;
set local lock_timeout = '5s';

-- Serialize against transfer RPCs, which hold the same properties row lock.
-- A transferred source is a frozen ledger snapshot. Never silently move a void
-- to its recipient or reassign old receipts to another homeowner.
create or replace function public.guard_transferred_financial_record()
returns trigger language plpgsql security definer set search_path = '' as $$
declare account_id bigint;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'payments' then
      if old.status = 'Voided' or new.status is distinct from 'Voided' then return new; end if;
    else
      if old.voided_at is not null or new.voided_at is null then return new; end if;
    end if;
    account_id := old.property_id;
  else
    account_id := new.property_id;
  end if;
  perform 1 from public.properties where id = account_id for update;
  if exists (select 1 from public.homeowner_balance_transfers where previous_property_id = account_id) then
    raise exception using errcode = '23514',
      message = 'This account balance has already been transferred. Its original financial records cannot be changed. Request a reviewed correction for the current account.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_transferred_financial_record() from public, anon, authenticated;
create or replace trigger a_guard_transferred_payment
  before update of status on public.payments
  for each row execute function public.guard_transferred_financial_record();
create or replace trigger a_guard_transferred_charge
  before insert or update of voided_at on public.property_charges
  for each row execute function public.guard_transferred_financial_record();
create or replace trigger a_guard_transferred_balance
  before insert or update of voided_at on public.balance_entries
  for each row execute function public.guard_transferred_financial_record();

-- Positive-number checks alone accept numeric NaN in PostgreSQL. Reject all
-- non-finite values at each monetary input/ledger boundary, including rates and
-- lot area used to compute dues. Existing signs, rounding and NULL rules stay.
-- If a historic row is invalid, validation aborts this migration; never clean it
-- up or replace it with zero automatically.
do $$
declare rule record; predicate text; col text; existing text;
begin
  for rule in select * from (values
    ('account_adjustments',array['balance_effect']),
    ('amenity_services',array['rate']),
    ('annual_penalty_assessments',array['base_amount','rate','penalty_amount']),
    ('balance_entries',array['amount']),
    ('bank_deposits',array['amount']),
    ('expenses',array['amount']),
    ('homeowner_balance_transfers',array['transferred_balance']),
    ('late_payment_penalties',array['base_amount','rate','penalty_amount']),
    ('late_penalty_year_rates',array['rate']),
    ('moved_account_reconciliations',array['adjustment_amount']),
    ('payment_allocations',array['amount']),
    ('payments',array['amount','amount_paid','previous_balance','remaining_balance','balance_effect','effect_released']),
    ('properties',array['current_balance','opening_balance','lot_size_sqm']),
    ('property_charges',array['amount']),
    ('property_payment_allocations',array['allocated_amount']),
    ('service_transactions',array['amount_due','amount_paid','unit_rate']),
    ('system_settings',array['late_penalty','price_per_sqm','late_penalty_rate']),
    ('violations',array['fine_amount'])
  ) as rules(table_name,columns) loop
    predicate := '';
    foreach col in array rule.columns loop
      predicate := predicate || case when predicate = '' then '' else ' and ' end ||
        format('(%I is null or %I not in (''NaN''::numeric,''Infinity''::numeric,''-Infinity''::numeric))',col,col);
    end loop;
    -- Reapplication replaces this named check and revalidates existing rows;
    -- it never updates the stored amounts.
    select pg_get_expr(c.conbin,c.conrelid) into existing from pg_constraint c
      where c.conrelid = format('public.%I',rule.table_name)::regclass
        and c.conname = 'financial_values_finite';
    if found then
      execute format('alter table public.%I drop constraint financial_values_finite',rule.table_name);
    end if;
    execute format('alter table public.%I add constraint financial_values_finite check (%s) not valid',rule.table_name,predicate);
    execute format('alter table public.%I validate constraint financial_values_finite',rule.table_name);
  end loop;
end;
$$;

-- Existing triggers call this logger. Financial actions by signed-in staff now
-- use the already-installed mandatory helper: failure OR suppressed INSERT
-- rolls back the business statement and all trigger side effects atomically.
-- Other event types retain their existing behavior. JWT-less trusted scheduled
-- work retains its system journals (annual_penalty_assessments), not a fake user.
create or replace function public.write_audit_log(p_action text,p_target text)
returns void language plpgsql security definer set search_path = '' as $$
declare previous_flag text := coalesce(nullif(current_setting('app.audit_trigger',true),''),'off');
begin
  if p_action in ('Payment Recorded','Payment Voided','Charge Added','Charge Voided','Charge Restored',
                  'Service Payment Recorded','Service Balance Collected','Service Receipt Voided') then
    if auth.uid() is null then
      if session_user in ('postgres','supabase_admin')
         and coalesce(current_setting('role',true),'none') not in ('anon','authenticated') then
        return;
      end if;
      raise exception using errcode='42501',message='An active staff actor is required to record this financial action.';
    end if;
    perform public.write_required_balance_audit(p_action,p_target);
    return;
  end if;
  if auth.uid() is null then return; end if;
  begin
    perform pg_catalog.set_config('app.audit_trigger','on',true);
    insert into public.activity_log(user_id,action,target) values(auth.uid(),p_action,p_target);
    perform pg_catalog.set_config('app.audit_trigger',previous_flag,true);
  exception when others then
    perform pg_catalog.set_config('app.audit_trigger',previous_flag,true);
    raise warning 'activity log write failed: %',sqlerrm;
  end;
end;
$$;
revoke all on function public.write_audit_log(text,text) from public, anon, authenticated;

notify pgrst,'reload schema';
commit;
