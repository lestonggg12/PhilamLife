begin;
set local lock_timeout = '5s';
drop trigger if exists a00_stamp_staff_payment_receipt_metadata on public.payments;
drop function if exists public.stamp_staff_payment_receipt_metadata();
commit;
