create or replace function public.set_payment_date()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.payment_date is null then
    new.payment_date := (new.paid_at at time zone 'Asia/Manila')::date;
  end if;
  return new;
end;
$$;

drop trigger if exists set_payment_date on public.payments;
create trigger set_payment_date
before insert on public.payments
for each row execute function public.set_payment_date();

update public.payments
set payment_date = (paid_at at time zone 'Asia/Manila')::date
where payment_date is null;

alter table public.payments alter column payment_date set not null;