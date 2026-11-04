-- Expense entry controls. Additive and deliberately non-retroactive.
-- Historical expense and cancellation rows retain their original evidence.
alter table public.expenses
  add column if not exists supporting_note text,
  add column if not exists backdate_reason text;

-- Preserve existing server identity, amount and audit behaviors while applying
-- new business rules to newly inserted expense records.
create or replace function public.prepare_expense_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  today_manila date := (now() at time zone 'Asia/Manila')::date;
begin
  if auth.uid() is null or coalesce(public.current_user_role(),'') <> 'treasurer' then
    raise exception using errcode='42501',
      message='An active Treasurer account is required to record an expense.';
  end if;
  if new.amount is null or new.amount <= 0 or
     new.amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) then
    raise exception using errcode='22023',
      message='Enter a finite expense amount greater than zero.';
  end if;
  if new.expense_date is null then
    raise exception using errcode='22023', message='Select an expense date.';
  end if;
  if new.expense_date > today_manila then
    raise exception using errcode='22023',
      message='Future expense dates are not permitted. Record the expense when it occurs.';
  end if;

  new.reference_number := nullif(btrim(new.reference_number), '');
  new.supporting_note := nullif(btrim(new.supporting_note), '');
  new.backdate_reason := nullif(btrim(new.backdate_reason), '');

  if new.reference_number is null and
     (new.supporting_note is null or length(new.supporting_note) not between 10 and 500) then
    raise exception using errcode='22023',
      message='Provide a reference number, or explain missing supporting documentation (10 to 500 characters).';
  end if;
  if new.supporting_note is not null and length(new.supporting_note) > 500 then
    raise exception using errcode='22023', message='Supporting explanation is too long (maximum 500 characters).';
  end if;
  if new.expense_date < today_manila then
    if new.backdate_reason is null or length(new.backdate_reason) not between 10 and 500 then
      raise exception using errcode='22023',
        message='Explain why the expense is being recorded for an earlier date (10 to 500 characters).';
    end if;
  elsif new.backdate_reason is not null then
    raise exception using errcode='22023',
      message='A backdate reason may only be entered for a past expense date.';
  end if;
  if exists (
    select 1 from public.accounting_periods ap
    where ap.status = 'closed'
      and new.expense_date between ap.starts_on and ap.ends_on
  ) then
    raise exception using errcode='22023',
      message='This expense date is in a closed accounting period; contact the office for a documented correction.';
  end if;

  new.recorded_by := auth.uid();
  select coalesce(nullif(btrim(full_name),''),email,'Treasurer')
    into new.recorded_by_name from public.profiles where id=auth.uid();
  new.created_at := now();
  new.status := 'Completed';
  new.voided_at := null;
  new.voided_by := null;
  new.voided_by_name := null;
  new.void_reason := null;
  return new;
end;
$function$;

-- Voids are corrections to a period's recorded totals. Protect closed periods;
-- preserve new supporting evidence and the original claimed expense date.
create or replace function public.protect_expense_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or coalesce(public.current_user_role(),'') <> 'treasurer' then
    raise exception using errcode='42501',
      message='Only an active Treasurer can void expenses.';
  end if;
  if old.status='Voided' then
    raise exception 'This expense is already voided.';
  end if;
  if new.status is distinct from 'Voided' then
    raise exception 'Expenses cannot be edited. Void the original with a reason and record a correction.';
  end if;
  if exists (
    select 1 from public.accounting_periods ap
    where ap.status='closed' and old.expense_date between ap.starts_on and ap.ends_on
  ) then
    raise exception using errcode='22023',
      message='Cannot void an expense from a closed accounting period. Contact the office for a documented correction.';
  end if;
  new.void_reason := btrim(new.void_reason);
  if new.void_reason is null or length(new.void_reason) not between 5 and 500 then
    raise exception using errcode='22023',
      message='Enter a cancellation reason of 5 to 500 characters.';
  end if;
  new.id := old.id;
  new.expense_date := old.expense_date;
  new.category := old.category;
  new.description := old.description;
  new.amount := old.amount;
  new.reference_number := old.reference_number;
  new.supporting_note := old.supporting_note;
  new.backdate_reason := old.backdate_reason;
  new.submission_key := old.submission_key;
  new.recorded_by := old.recorded_by;
  new.recorded_by_name := old.recorded_by_name;
  new.created_at := old.created_at;
  new.voided_at := now();
  new.voided_by := auth.uid();
  select coalesce(nullif(btrim(full_name),''),email,'Treasurer')
    into new.voided_by_name from public.profiles where id=auth.uid();
  return new;
end;
$function$;