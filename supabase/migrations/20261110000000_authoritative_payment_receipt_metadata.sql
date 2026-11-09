-- Stamp new authenticated payments at the database boundary. Historical
-- payments and trusted imports without a staff JWT retain their source data.
begin;
set local lock_timeout = '5s';

create function public.stamp_staff_payment_receipt_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.paid_at := statement_timestamp();
    new.created_at := new.paid_at;
    new.payment_date := (new.paid_at at time zone 'Asia/Manila')::date;
    -- prepare_payment_record generates the official number from the stamped date.
    new.receipt_number := null;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_staff_payment_receipt_metadata() from public, anon, authenticated;

-- Before duplicate detection and receipt/balance preparation.
create trigger a00_stamp_staff_payment_receipt_metadata
before insert on public.payments
for each row execute function public.stamp_staff_payment_receipt_metadata();

commit;
