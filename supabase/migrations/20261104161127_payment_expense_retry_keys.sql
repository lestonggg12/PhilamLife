-- Payment / expense retry identity. Additive only: preserve all historical records.
-- A UUID identifies one distinct staff submission. Unique indexes protect retries
-- across timeouts, tabs and process restarts without relying on a 15-second window.
alter table public.payments add column if not exists submission_key uuid;
alter table public.expenses add column if not exists submission_key uuid;

create unique index if not exists payments_submission_key_unique
  on public.payments (submission_key) where submission_key is not null;
create unique index if not exists expenses_submission_key_unique
  on public.expenses (submission_key) where submission_key is not null;

-- Staff can void/correct supported records, but may not reassign a payment's
-- original submission identity. This also protects old NULL-key records.
create or replace function public.protect_financial_submission_key()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.submission_key is distinct from old.submission_key then
    raise exception using errcode = '22023',
      message = 'Submission identity is immutable. Create a new transaction for a distinct payment or expense.';
  end if;
  return new;
end;
$function$;

revoke all on function public.protect_financial_submission_key() from public, anon, authenticated;

drop trigger if exists lock_payment_submission_key on public.payments;
create trigger lock_payment_submission_key
  before update on public.payments for each row
  execute function public.protect_financial_submission_key();

drop trigger if exists lock_expense_submission_key on public.expenses;
create trigger lock_expense_submission_key
  before update on public.expenses for each row
  execute function public.protect_financial_submission_key();